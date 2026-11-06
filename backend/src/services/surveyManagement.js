import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import * as XLSX from 'xlsx';
import {unwrap,allRows} from './database.js';
import {containedPath} from './localSecurity.js';
import {fail,uuid} from '../validators.js';

const text=z.string().trim().max(160).optional();
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>!Number.isNaN(Date.parse(s))).optional();
const filters=z.object({project:text,survey:text,uploader:text,reviewer:text,status:z.enum(['','Pending','Verified','Rejected']).optional(),from:day,to:day,project_id:uuid.optional(),limit:z.coerce.number().int().min(1).max(100).default(25),offset:z.coerce.number().int().min(0).max(1000000).default(0),format:z.enum(['csv','xlsx']).optional()}).strict();
const scopeSchema=z.object({scope:z.enum(['project','survey','all','reset']),id:uuid.nullable().optional()}).strict().refine(v=>!['project','survey'].includes(v.scope)||Boolean(v.id),{message:'Select a project or survey.'});
const phraseFor=scope=>scope==='reset'?'RESET SURVEY DATABASE':'DELETE ALL PROJECTS';
const safeCell=value=>typeof value==='string'&&/^[\s]*[=+@\-]/.test(value)?"'"+value:value;

export function installSurveyManagement({app,dbs,config,role,verifyProjectAccess,processor}) {
  const plans=new Map();let maintenance=false;let activeWrites=0;
  const rpc=async(name,args)=>unwrap(await dbs.admin.rpc(name,args));
  // This gate is installed before every survey mutation route.
  app.use('/api',(req,res,next)=>{
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!req.path.startsWith('/management/')) {
      if(maintenance)return next(fail(503,'Database maintenance is running. Retry when it finishes.'));
      activeWrites++;let ended=false;const finish=()=>{if(!ended){ended=true;activeWrites--;}};
      res.once('finish',finish);res.once('close',finish);
    }
    next();
  });
  const allowedProjects=async req=>{
    if(req.profile.role==='admin')return [];
    const projects=await allRows(()=>req.db.from('projects').select('*').order('id'));
    const ids=[];
    for(const project of projects){try{await verifyProjectAccess(req,project);ids.push(project.id);}catch(error){if(error.code!=='PROJECT_PASSWORD_REQUIRED')throw error;}}
    return ids;
  };
  const history=async(req,input)=>rpc('survey_history',{p_actor:req.actor,p_filters:{...input,allowed_projects:await allowedProjects(req)}});
  app.get('/api/uploads/history',async(req,res)=>{
    const f=filters.parse(req.query);if(f.from&&f.to&&f.from>f.to)throw fail(400,'Start date must be before end date.');
    const data=await history(req,f);res.json({...data,offset:f.offset,limit:f.limit,hasMore:f.offset+data.history.length<data.total});
  });
  app.get('/api/uploads/history/export',async(req,res)=>{
    const f=filters.parse(req.query);if(f.from&&f.to&&f.from>f.to)throw fail(400,'Start date must be before end date.');
    const records=[];let offset=0;const allowed=await allowedProjects(req);
    while(true){const page=await rpc('survey_history',{p_actor:req.actor,p_filters:{...f,allowed_projects:allowed,offset,limit:1000}});records.push(...page.history);offset+=page.history.length;if(offset>=page.total||!page.history.length)break;}
    const rows=records.map(h=>Object.fromEntries(Object.entries({'Project Name':h.project_name,'Survey Number':h.survey_number,Document:h.document_name,'File Name':h.original_file_name,'Uploaded By':h.user_name,'Uploaded User ID':h.user_id,'Upload Date':h.upload_timestamp,'Reviewed By':h.reviewer_name,'Reviewer ID':h.reviewer_id,'Review Date':h.reviewed_at,Status:h.verification_status,Remarks:h.review_remarks,Removed:h.removed_at||''}).map(([k,v])=>[k,safeCell(v??'')])));
    const headers=['Project Name','Survey Number','Document','File Name','Uploaded By','Uploaded User ID','Upload Date','Reviewed By','Reviewer ID','Review Date','Status','Remarks','Removed'];
    const sheet=XLSX.utils.json_to_sheet(rows,{header:headers});
    if(f.format==='xlsx'){const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Upload history');res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment('upload-history.xlsx').send(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));}
    else res.type('text/csv').attachment('upload-history.csv').send('\uFEFF'+XLSX.utils.sheet_to_csv(sheet));
  });
  app.get('/api/reviews',async(req,res)=>{
    const f=z.object({document_id:uuid.optional(),limit:z.coerce.number().int().min(1).max(100).default(50),offset:z.coerce.number().int().min(0).max(1000000).default(0)}).strict().parse(req.query);
    res.json(await rpc('survey_activity',{p_actor:req.actor,p_filters:{...f,kind:'reviews',allowed_projects:await allowedProjects(req)}}));
  });
  app.get('/api/audit',role('admin'),async(req,res)=>{
    const f=z.object({action:text,search:text,limit:z.coerce.number().int().min(1).max(100).default(50),offset:z.coerce.number().int().min(0).max(1000000).default(0)}).strict().parse(req.query);
    res.json(await rpc('survey_activity',{p_actor:req.actor,p_filters:{...f,kind:'audit'}}));
  });
  app.get('/api/dashboard/activity',async(req,res)=>{
    const allowed=await allowedProjects(req);
    const [uploads,reviews,activities]=await Promise.all([
      rpc('survey_history',{p_actor:req.actor,p_filters:{limit:5,allowed_projects:allowed}}),
      rpc('survey_activity',{p_actor:req.actor,p_filters:{kind:'reviews',limit:5,allowed_projects:allowed}}),
      req.profile.role==='admin'?rpc('survey_activity',{p_actor:req.actor,p_filters:{kind:'audit',limit:5}}):Promise.resolve({rows:[]})
    ]);res.json({uploads:uploads.history,reviews:reviews.rows,activities:activities.rows});
  });
  app.get('/api/management/summary',role('admin'),async(req,res)=>{
    const plan=await rpc('survey_delete_preview',{p_actor:req.actor,p_scope:'reset',p_id:null});
    const {files=[],project_ids=[],property_ids=[],fingerprint='',...summary}=plan||{};
    const queued=await allRows(()=>dbs.admin.from('storage_cleanup').select('*').order('storage_path'));
    const pendingOperations={};for(const row of queued)if(row.operation_id)pendingOperations[row.operation_id]=(pendingOperations[row.operation_id]||0)+1;
    res.json({...summary,pendingOperations,backupEnabled:config.surveyBackupEnabled!==false});
  });
  app.post('/api/management/preview',role('admin'),async(req,res)=>{
    const scope=scopeSchema.parse(req.body);
    if(maintenance)throw fail(409,'A maintenance operation is already running.');
    for(const [token,plan] of plans)if(plan.expires<Date.now())plans.delete(token);
    const plan=await rpc('survey_delete_preview',{p_actor:req.actor,p_scope:scope.scope,p_id:scope.id||null});
    const token=randomBytes(32).toString('base64url');
    plans.set(token,{actor:req.actor,session:req.token,scope,plan,expires:Date.now()+5*60000});
    const {files=[],project_ids=[],property_ids=[],fingerprint='',...counts}=plan||{};
    res.json({...counts,token,phrase:phraseFor(scope.scope),expiresIn:300,backupEnabled:config.surveyBackupEnabled!==false,storageObjects:(files||[]).length,policy:scope.scope==='reset'?'Upload and review history will be removed. Audit records, users, accounts, settings and document categories remain.':'Upload and review history will be retained. Associated files will be removed. Users and audit records remain.'});
  });
  async function backup(req,plan,operation) {
    if(config.surveyBackupEnabled===false)return null;
    const folder=path.resolve(config.surveyBackupDirectory||(process.env.VERCEL?'/tmp/backups/operations':'backups/operations'),operation);
    try {
      await mkdir(folder,{recursive:true});
      const data=await rpc('survey_backup',{p_actor:req.actor})||{};
      await writeFile(path.join(folder,'survey-data.json'),JSON.stringify(data,null,2),{flag:'wx'});
      if(dbs.snapshotBackup)await dbs.snapshotBackup(path.join(folder,'survey_db.tar.gz'));
      const records=[];
      // Back up all known survey objects, so the logical export and storage are a matching set.
      const files=new Map([...(data.upload_history||[]),...(data.uploaded_files||[]),...(data.storage_cleanup||[])].map(f=>[f.storage_path,f]));
      const active=new Set((data.uploaded_files||[]).map(f=>f.storage_path));
      for(const [storagePath] of files){
        const result=await dbs.admin.storage.from(config.bucket).download(storagePath);
        if(result.error){if(active.has(storagePath))throw fail(503,'Backup failed: an active document could not be read. Nothing was deleted.');records.push({storagePath,missing:true});continue;}
        const bytes=Buffer.from(await result.data.arrayBuffer());const target=containedPath(folder,'storage',config.bucket,storagePath);
        await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});
        records.push({storagePath,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
      }
      await writeFile(path.join(folder,'manifest.json'),JSON.stringify({operation,scope:plan.scope,createdAt:new Date().toISOString(),actor:req.actor,files:records,tables:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,(v||[]).length]))},null,2),{flag:'wx'});
      return folder;
    } catch(err) {
      console.warn('Survey backup failed:', err.message);
      throw fail(503,'Backup failed. Nothing was deleted. Restore backup storage access and try again.');
    }
  }
  async function cleanup(operation) {
    const rows=await allRows(()=>dbs.admin.from('storage_cleanup').select('*').eq('operation_id',operation).order('storage_path'));
    let removed=0;
    for(const row of rows){
      const existing=unwrap(await dbs.admin.from('uploaded_files').select('id').eq('storage_path',row.storage_path).maybeSingle());
      if(existing)continue;
      const result=await dbs.admin.storage.from(config.bucket).remove([row.storage_path]);
      if(!result.error){unwrap(await dbs.admin.from('storage_cleanup').delete().eq('storage_path',row.storage_path));removed++;}
    }
    await dbs.flush?.();return {removed,pending:rows.length-removed};
  }
  app.post('/api/management/execute',role('admin'),async(req,res)=>{
    const input=z.object({token:z.string().min(20).max(100),phrase:z.string().max(80),confirmed:z.literal(true)}).strict().parse(req.body);
    const entry=plans.get(input.token);
    if(!entry||entry.actor!==req.actor||entry.session!==req.token||entry.expires<Date.now())throw fail(409,'Confirmation expired or invalid. Preview again.');
    if(input.phrase!==phraseFor(entry.scope.scope))throw fail(400,'Type the exact confirmation phrase.');
    if(maintenance||activeWrites)throw fail(409,'Another change is running. Wait for it to finish, then preview again.');
    maintenance=true;plans.delete(input.token);
    try {
      await processor?.drain();
      const current=await rpc('survey_delete_preview',{p_actor:req.actor,p_scope:entry.scope.scope,p_id:entry.scope.id||null});
      if(current.fingerprint!==entry.plan.fingerprint)throw fail(409,'Data changed since preview. Review the new counts and confirm again.');
      const operation=randomUUID();const backupPath=await backup(req,current,operation);
      const result=await rpc('survey_destroy',{p_actor:req.actor,p_scope:entry.scope.scope,p_id:entry.scope.id||null,p_fingerprint:current.fingerprint,p_phrase:input.phrase,p_confirmed:true,p_operation:operation,p_ip:req.ip});
      await dbs.flush?.();
      const storage=await cleanup(operation);
      res.json({...result,backupPath,storage});
    } finally {maintenance=false;}
  });
  app.post('/api/management/storage/:id/retry',role('admin'),async(req,res)=>{
    if(maintenance)throw fail(409,'Maintenance in progress.');
    res.json(await cleanup(uuid.parse(req.params.id)));
  });
  app.post('/api/management/projects/:id/archive',role('admin'),async(req,res)=>{
    if(maintenance)throw fail(409,'Maintenance in progress.');
    const {archived}=z.object({archived:z.boolean()}).strict().parse(req.body);
    await rpc('survey_archive',{p_actor:req.actor,p_id:uuid.parse(req.params.id),p_archived:archived,p_ip:req.ip});await dbs.flush?.();res.json({success:true});
  });
}
