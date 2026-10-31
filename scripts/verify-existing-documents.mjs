import {PGlite} from '@electric-sql/pglite';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {analyzeDocument} from '../backend/src/services/analyzer.js';
const backup='backups/local-2026-10-30T08-43-56-580Z';
const source=new PGlite({loadDataDir:new Blob([await readFile(backup+'/survey_db.tar.gz')])});await source.waitReady;
const credentials=(await source.query("select email,password from auth.users where id='10000000-0000-4000-8000-000000000007'")).rows[0];
const response=await fetch('http://localhost:3000/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)});
if(!response.ok)throw Error('Local verification login failed.');
const session=await response.json();const headers={Authorization:'Bearer '+session.access_token};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=(await source.query('select * from uploaded_files order by id')).rows;
const results=[];
try{
 for(const file of files){
  const link=await fetch('http://localhost:3000/api/files/'+file.id+'/url?download=1',{headers});if(!link.ok)throw Error('Could not authorize download: '+file.id);
  const {url}=await link.json();const download=await fetch(new URL(url,'http://localhost:3000'));const buffer=Buffer.from(await download.arrayBuffer());
  const original=await readFile(backup+'/storage/land-documents/'+file.storage_path);
  const analysis=await analyzeDocument({buffer,mimeType:file.mime_type,originalFileName:file.original_file_name});
  const old=(await source.query('select survey_number,subdivision from extracted_survey_numbers where upload_id=$1',[file.id])).rows;
  const key=e=>e.survey_number+'/'+e.subdivision;
  results.push({id:file.id,filename:file.original_file_name,downloadStatus:download.status,bytes:buffer.length,sizeMatches:buffer.length===Number(file.file_size),sha256Matches:hash(buffer)===hash(original),parseStatus:analysis.status,sourceSurveyCount:analysis.entries.length,historicalSurveyCount:old.length,sourceSurveyNumbersMatchHistory:JSON.stringify(analysis.entries.map(key).sort())===JSON.stringify(old.map(key).sort())});
 }
 const history=await fetch('http://localhost:3000/api/uploads/history?project_id=11111111-1111-4000-8000-000000000001',{headers});const records=(await history.json()).history;
 const report={checkedAt:new Date().toISOString(),documentsChecked:results.length,downloaded:results.filter(r=>r.downloadStatus===200).length,parsed:results.filter(r=>r.parseStatus==='Completed').length,integrityMatched:results.filter(r=>r.sha256Matches&&r.sizeMatches).length,archivedHistoryRows:records.length,allHistoryProjectIdsCorrect:records.every(r=>r.project_id==='11111111-1111-4000-8000-000000000001'&&r.property_id&&r.property_document_id),results};
 await writeFile('artifacts/existing-document-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,results:undefined}));
}finally{await fetch('http://localhost:3000/api/auth/logout',{method:'POST',headers});await source.close();}
