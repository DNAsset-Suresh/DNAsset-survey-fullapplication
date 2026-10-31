import { randomUUID } from 'node:crypto';
import { unwrap } from './database.js';
import { runAnalysis } from './runAnalysis.js';

// Files are read from durable storage one at a time, never retained in an in-memory job queue.
export function uploadProcessor({admin,config,mailer,flush}) {
  const pending=new Set();let running=null;
  async function process(id){
    const h=unwrap(await admin.from('upload_history').select('*').eq('upload_id',id).maybeSingle());
    if(!h || !['Uploaded','Processing'].includes(h.processing_status))return;
    try{
      unwrap(await admin.from('upload_history').update({processing_status:'Processing'}).eq('id',h.id));
      const downloaded=await admin.storage.from(config.bucket).download(h.storage_path);
      if(downloaded.error)throw Error('Stored document is missing or unreadable.');
      const buffer=Buffer.from(await downloaded.data.arrayBuffer());
      const result=await runAnalysis({buffer,mimeType:h.mime_type,originalFileName:h.original_file_name,uploaderName:h.user_name});
      const previous=unwrap(await admin.from('document_analyses').select('id').eq('upload_id',id).maybeSingle());
      const analysisId=previous?.id||randomUUID();
      const record={upload_id:id,property_document_id:h.property_document_id,property_id:h.property_id,uploaded_by:h.user_id,original_file_name:h.original_file_name,status:result.status,error_message:result.errorMessage,summary:result.summary};
      if(previous){unwrap(await admin.from('document_analyses').update(record).eq('id',analysisId));unwrap(await admin.from('extracted_survey_numbers').delete().eq('analysis_id',analysisId));}
      else unwrap(await admin.from('document_analyses').insert({id:analysisId,...record}));
      if(result.entries.length)unwrap(await admin.from('extracted_survey_numbers').insert(result.entries.map((e,i)=>({...e,analysis_id:analysisId,upload_id:id,s_no:i+1,review_reason:e.requires_manual_review?'Review against source document':''}))));
      unwrap(await admin.from('upload_history').update({processing_status:result.status}).eq('id',h.id));
      // The checklist association stays separate from extracted source survey numbers.
      if(mailer.enabled && h.email_notification_status!=='sent'){
        const mail=await mailer.sendUploadNotification({uploaderName:h.user_name,uploaderEmail:h.user_email,userId:h.user_id,fileName:h.original_file_name,fileType:h.mime_type,fileSize:h.file_size,uploadDate:new Date(h.upload_timestamp),surveyNumbers:h.associated_survey_numbers,documentLink:config.origins[0]+'/#survey/'+h.property_id,processingStatus:result.status});
        unwrap(await admin.from('upload_history').update({email_notification_status:mail.success?'sent':'failed',email_sent_at:mail.success?new Date().toISOString():null,email_notification_error:mail.success?null:'Notification delivery failed.'}).eq('id',h.id));
      }else if(!mailer.enabled)unwrap(await admin.from('upload_history').update({email_notification_status:'skipped'}).eq('id',h.id));
    }catch(error){
      console.error('Upload processing failed:',error.message);
      unwrap(await admin.from('upload_history').update({processing_status:'Failed'}).eq('id',h.id));
    }
    await flush?.();
  }
  function enqueue(id){
    pending.add(id);
    if(!running)running=new Promise(resolve=>setImmediate(resolve)).then(async()=>{while(pending.size){const id=pending.values().next().value;pending.delete(id);await process(id);}}).finally(()=>{running=null;});
  }
  return {enqueue,async drain(){while(running)await running;},async recover(){for(;;){const rows=unwrap(await admin.from('upload_history').select('upload_id').in('processing_status',['Uploaded','Processing']).order('upload_timestamp').limit(100));const ids=rows.filter(h=>h.upload_id).map(h=>h.upload_id);for(const id of ids)enqueue(id);await this.drain();if(ids.length<100)return;}}};
}
