import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {writeFile,readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import * as XLSX from 'xlsx';
import {configuration} from '../backend/src/config.js';
import {createApp} from '../backend/src/app.js';
import {initLocalClients} from './localFixture.js';
import {replaceWithPondy} from '../backend/src/services/projectReplacement.js';
import {analyzeDocument} from '../backend/src/services/analyzer.js';
import {checklist,checklistsForProperties} from '../backend/src/services/database.js';
import {containedPath} from '../backend/src/services/localSecurity.js';
import {createCanvas} from '@napi-rs/canvas';
import http from 'node:http';
import {once} from 'node:events';
import {runAnalysis} from '../backend/src/services/runAnalysis.js';
import {createHash} from 'node:crypto';

test('Safety and replacement regression',async t=>{
 const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
 const activeBefore=digest(await readFile('database/survey_db.tar.gz'));
 const config=configuration({USE_LOCAL_DB:'true',MAX_FILE_SIZE_MB:'1'});
 const clients=await initLocalClients(config),db=clients.dbInstance,app=createApp(config,clients);
 t.after(async()=>{await app.locals.drainUploads();await clients.dbInstance.close();assert.equal(digest(await readFile('database/survey_db.tar.gz')),activeBefore,'Tests must never modify the saved database; stop the app during this check');});
 const login=async(email,password)=>(await request(app).post('/api/auth/login').send({email,password}).expect(200)).body;
 const admin=await login('dna.callus@gmail.com','dna.suresh123');
 const user=await login('user@dnassets.com','user123');
 const viewer=await login('viewer@dnassets.com','viewer123');
 const auth=token=>({Authorization:'Bearer '+token});
 let replacement,documentId,fileId;
 const timings={};
 await t.test('[Security] Universal password and forged sessions are rejected',async()=>{
  await request(app).post('/api/auth/login').send({email:'dna.callus@gmail.com',password:'password'}).expect(401);
  await request(app).get('/api/me').set(auth('forged')).expect(401);
 });
 await t.test('[Security] Logout revokes both access and refresh tokens',async()=>{
  const s=await login('reviewer@dnassets.com','reviewer123');
  await request(app).post('/api/auth/logout').set(auth(s.access_token)).expect(204);
  await request(app).get('/api/me').set(auth(s.access_token)).expect(401);
  await request(app).post('/api/auth/refresh').send({refresh_token:s.refresh_token}).expect(401);
 });
 await t.test('[Security] Refresh rotates and invalidates the previous token pair',async()=>{
  const s=await login('reviewer@dnassets.com','reviewer123');
  const rotated=await request(app).post('/api/auth/refresh').send({refresh_token:s.refresh_token}).expect(200);
  assert.notEqual(rotated.body.access_token,s.access_token);
  await request(app).get('/api/me').set(auth(s.access_token)).expect(401);
  await request(app).post('/api/auth/refresh').send({refresh_token:s.refresh_token}).expect(401);
 });
 await t.test('[Performance] Compare original and batched matrix query assembly on the same fixture',async()=>{
  const surveys=(await db.query('select * from properties order by id')).rows;
  const before=[],after=[];
  for(let i=0;i<5;i++){
   let start=performance.now();const a=await Promise.all(surveys.map(s=>checklist(clients.admin,s.id)));before.push(performance.now()-start);
   start=performance.now();const b=await checklistsForProperties(clients.admin,surveys);after.push(performance.now()-start);assert.equal(a.flatMap(x=>x.documents).length,b.flatMap(x=>x.documents).length);
  }
  timings.matrix={surveys:surveys.length,repetitions:5,beforeMilliseconds:before,afterMilliseconds:after,beforeQueries:surveys.length*4,afterQueries:3};
 });
 await t.test('[Database] Archive replacement creates an isolated pondy / 231 and retains other projects',async()=>{
  const other=(await clients.admin.rpc('save_project',{p_actor:'10000000-0000-4000-8000-000000000007',p_data:{project_name:'Unrelated project'}})).data;
  const previous=(await db.query('select * from projects where id=$1',[other])).rows;
  replacement=await replaceWithPondy(db);
  assert.notEqual(replacement.projectId,replacement.archivedProjectId);
  assert.deepEqual((await db.query('select * from projects where id=$1',[other])).rows,previous);
  assert.ok((await db.query('select archived_at from projects where id=$1',[replacement.archivedProjectId])).rows[0].archived_at);
  assert.equal((await db.query('select count(*)::int n from properties where project_id=$1',[replacement.archivedProjectId])).rows[0].n,4);
  await assert.rejects(replaceWithPondy(db),/Expected active/);
 });
 await t.test('[Functional] Active project/survey lists and clean seven-category checklist',async()=>{
  const projects=await request(app).get('/api/projects').set(auth(admin.access_token)).expect(200);
  assert.ok(projects.body.some(p=>p.id===replacement.projectId));assert.ok(!projects.body.some(p=>p.id===replacement.archivedProjectId));
  const start=performance.now();const list=await request(app).get('/api/properties').set(auth(admin.access_token)).expect(200);timings.surveyListApiMs=performance.now()-start;
  assert.equal(list.body.length,1);assert.equal(list.body[0].survey_number,'231');
  const c=await request(app).get(`/api/properties/${replacement.propertyId}/checklist`).set(auth(admin.access_token)).expect(200);
  assert.equal(c.body.documents.length,7);assert.equal(c.body.documents.flatMap(d=>d.files).length,0);documentId=c.body.documents[0].id;
 });
 await t.test('[Security] Changing project/document IDs cannot bypass assignment',async()=>{
  for(const endpoint of [`/projects/${replacement.projectId}`,`/properties/${replacement.propertyId}/checklist`,`/documents/${documentId}/files`])await request(app).get('/api'+endpoint).set(auth(user.access_token)).expect(404);
  await request(app).post(`/api/projects/${replacement.projectId}/unlock`).set(auth(user.access_token)).send({password:'any'}).expect(404);
  const list=await request(app).get('/api/projects').set(auth(user.access_token)).expect(200);assert.ok(!list.body.some(p=>p.id===replacement.projectId));
 });
 await t.test('[API] Missing/invalid input and duplicate survey are rejected',async()=>{
  await request(app).post('/api/projects').set(auth(admin.access_token)).send({}).expect(400);
  await request(app).get('/api/uploads/history?limit=10000').set(auth(admin.access_token)).expect(400);
  await request(app).post(`/api/projects/${replacement.projectId}/survey-numbers`).set(auth(admin.access_token)).send({survey_number:'231'}).expect(409);
 });
 await t.test('[API] Batched document library excludes archives and unassigned projects',async()=>{
  const adminPage=await request(app).get('/api/checklists?limit=1').set(auth(admin.access_token)).expect(200);
  assert.equal(adminPage.body.checklists.length,1);assert.equal(adminPage.body.checklists[0].property.id,replacement.propertyId);assert.equal(adminPage.body.checklists[0].documents.length,7);
  const userPage=await request(app).get('/api/checklists').set(auth(user.access_token)).expect(200);assert.equal(userPage.body.checklists.length,0);
  await request(app).get('/api/checklists?limit=100').set(auth(admin.access_token)).expect(400);
 });
 await t.test('[Security] Public raw storage and traversal paths are denied',async()=>{
  await request(app).get('/api/storage/land-documents/any.pdf').expect(401);
  await request(app).get('/api/storage/download/forged').expect(404);
  assert.throws(()=>containedPath('storage/land-documents','../../../backend/.env'));
 });
 await t.test('[Document Upload] Empty, unsupported, oversized and corrupted files create no records',async()=>{
  const count=async()=>(await db.query('select count(*)::int n from uploaded_files')).rows[0].n;
  const before=await count();
  for(const [name,buffer,status] of [['empty.csv',Buffer.alloc(0),413],['bad.docx',Buffer.from('unsupported'),400],['bad.pdf',Buffer.from('not a PDF'),400],['big.csv',Buffer.alloc(1048577,65),413]])await request(app).post(`/api/documents/${documentId}/files`).set(auth(admin.access_token)).attach('file',buffer,name).expect(status);
  assert.equal(await count(),before);assert.equal((await db.query('select count(*)::int n from upload_history')).rows[0].n,0);
 });
 await t.test('[Document Upload] CSV filename spaces and punctuation survive upload and download byte-for-byte',async()=>{
  const buffer=Buffer.from('Survey Number,Village\n231,pondy\n');
  let start=performance.now();const uploaded=await request(app).post(`/api/documents/${documentId}/files`).set(auth(admin.access_token)).attach('file',buffer,'land - survey (231).csv').expect(201);timings.uploadMs=performance.now()-start;fileId=uploaded.body.id;
  const url=await request(app).get(`/api/files/${fileId}/url?download=1`).set(auth(admin.access_token)).expect(200);
  start=performance.now();const downloaded=await request(app).get(url.body.url).buffer(true).parse((res,callback)=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>callback(null,Buffer.concat(chunks)));}).expect(200);timings.downloadMs=performance.now()-start;
  assert.deepEqual(downloaded.body,buffer);await app.locals.drainUploads();
 });
 await t.test('[Upload History] Exact project, document, uploader, timestamp and size metadata',async()=>{
  const history=await request(app).get(`/api/uploads/history?project_id=${replacement.projectId}`).set(auth(admin.access_token)).expect(200);
  assert.equal(history.body.history.length,1);const h=history.body.history[0];assert.equal(h.project_id,replacement.projectId);assert.equal(h.property_id,replacement.propertyId);assert.equal(h.property_document_id,documentId);assert.equal(h.original_upload_id,fileId);assert.equal(h.user_id,'10000000-0000-4000-8000-000000000007');assert.ok(Date.parse(h.upload_timestamp));assert.equal(h.processing_status,'Completed');
  const archived=await request(app).get(`/api/uploads/history?project_id=${replacement.archivedProjectId}`).set(auth(admin.access_token)).expect(200);assert.equal(archived.body.history.length,0);
 });
 await t.test('[Upload History] Duplicate filenames retain distinct IDs and pagination',async()=>{
  const second=await request(app).post(`/api/documents/${documentId}/files`).set(auth(admin.access_token)).attach('file',Buffer.from('Survey Number\n231\n'),'land - survey (231).csv').expect(201);assert.notEqual(second.body.id,fileId);await app.locals.drainUploads();
  const first=await request(app).get('/api/uploads/history?limit=1').set(auth(admin.access_token)).expect(200);const next=await request(app).get('/api/uploads/history?limit=1&offset=1').set(auth(admin.access_token)).expect(200);assert.equal(first.body.hasMore,true);assert.notEqual(first.body.history[0].id,next.body.history[0].id);
 });
 await t.test('[Upload History] Replacement and deletion retain original history and invalidate old downloads',async()=>{
  const oldUrl=(await request(app).get(`/api/files/${fileId}/url`).set(auth(admin.access_token)).expect(200)).body.url;
  const replacementUpload=await request(app).post(`/api/documents/${documentId}/files`).set(auth(admin.access_token)).field('replace_id',fileId).attach('file',Buffer.from('Survey Number\n231\n'),'replacement.csv').expect(201);await app.locals.drainUploads();
  const old=(await db.query('select * from upload_history where original_upload_id=$1',[fileId])).rows[0];assert.equal(old.upload_id,null);assert.ok(old.removed_at);assert.equal(old.project_id,replacement.projectId);
  await request(app).get(oldUrl).expect(404);await request(app).delete(`/api/files/${replacementUpload.body.id}`).set(auth(admin.access_token)).expect(204);
  assert.equal((await db.query('select count(*)::int n from upload_history')).rows[0].n,3);
 });
 await t.test('[Document Upload] XLSX and XLS uploads parse source survey data',async()=>{
  for(const bookType of ['xlsx','xls']){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['S.No.','Survey Number','Village'],[1,'231','pondy']]),'Land');const buffer=XLSX.write(wb,{type:'buffer',bookType});const result=await request(app).post(`/api/documents/${documentId}/files`).set(auth(admin.access_token)).attach('file',buffer,'records.'+bookType).expect(201);await app.locals.drainUploads();const a=await request(app).get('/api/analyses/'+result.body.id).set(auth(admin.access_token)).expect(200);assert.deepEqual(a.body.extracted_surveys.map(e=>e.survey_number),['231']);}
 });
 await t.test('[Document Upload] PNG and JPEG are stored and downloaded without corruption',async()=>{
  const canvas=createCanvas(600,150),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,600,150);ctx.fillStyle='black';ctx.font='36px Arial';ctx.fillText('Survey No: 231',20,80);
  const ids=[];
  for(const [extension,mime] of [['png','image/png'],['jpg','image/jpeg']]){
   const bytes=canvas.toBuffer(mime);const uploaded=await request(app).post(`/api/documents/${documentId}/files`).set(auth(admin.access_token)).attach('file',bytes,'scan.'+extension).expect(201);
   ids.push(uploaded.body.id);
   const file=(await db.query('select * from uploaded_files where id=$1',[uploaded.body.id])).rows[0];
   const stored=await clients.admin.storage.from(config.bucket).download(file.storage_path);assert.deepEqual(Buffer.from(await stored.data.arrayBuffer()),bytes);
  }
  await app.locals.drainUploads();
  for(const id of ids){const rows=(await db.query('select survey_number,requires_manual_review from extracted_survey_numbers where upload_id=$1',[id])).rows;assert.deepEqual(rows.map(r=>r.survey_number),['231']);assert.ok(rows.every(r=>r.requires_manual_review));}
 });
 await t.test('[Document Upload] Interrupted multipart upload does not create file or history records',async()=>{
  const before=(await db.query('select count(*)::int n from upload_history')).rows[0].n;
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  await new Promise(resolve=>{
   const req=http.request({host:'127.0.0.1',port:server.address().port,path:`/api/documents/${documentId}/files`,method:'POST',headers:{...auth(admin.access_token),'Content-Type':'multipart/form-data; boundary=qa-boundary','Content-Length':'100000'} });
   req.on('error',()=>{});req.on('close',resolve);req.write('--qa-boundary\r\nContent-Disposition: form-data; name="file"; filename="interrupted.csv"\r\nContent-Type: text/csv\r\n\r\nSurvey Number\n');setTimeout(()=>req.destroy(),100);
  });
  await new Promise(resolve=>server.close(resolve));
  assert.equal((await db.query('select count(*)::int n from upload_history')).rows[0].n,before);
 });
 await t.test('[Performance] Bounded analysis timeout returns a manual-review failure',async()=>{
  const result=await runAnalysis({buffer:Buffer.from('Survey Number\n231'),mimeType:'text/csv',originalFileName:'source.csv'},{timeoutMs:1});assert.equal(result.status,'Failed');assert.match(result.errorMessage,/timed out/);
 });
 await t.test('[Functional] Extraction does not invent survey numbers from serials or dates',async()=>{
  for(const source of ['S.No.,Date,Area\n1,30/10/2026,500\n','Date,Amount\n30/10/2026,231\n']){const a=await analyzeDocument({buffer:Buffer.from(source),mimeType:'text/csv',originalFileName:'source.csv',property:{village:'Invented'}});assert.equal(a.entries.length,0);}
  const a=await analyzeDocument({buffer:Buffer.from('Survey Number\n231\n'),mimeType:'text/csv',originalFileName:'source.csv',property:{village:'Invented'}});assert.equal(a.entries[0].village,'Not Found');
 });
 await t.test('[Functional] Collection, verification and project report persist correctly',async()=>{
  await request(app).put(`/api/documents/${documentId}`).set(auth(admin.access_token)).send({is_collected:true}).expect(200);
  await request(app).post(`/api/documents/${documentId}/verification`).set(auth(admin.access_token)).send({verification_status:'Verified',survey_match_status:'Matches Survey Number'}).expect(200);
  const report=await request(app).get(`/api/reports/export?project_id=${replacement.projectId}&format=csv`).set(auth(admin.access_token)).expect(200);assert.match(report.text,/231/);assert.match(report.text,/Verified/);
 });
 await t.test('[Database] Restore snapshot preserves relationships, archive and history',async()=>{
  const blob=await db.dumpDataDir('gzip');const restored=new PGlite({loadDataDir:blob});await restored.waitReady;
  try{assert.equal((await restored.query('select count(*)::int n from upload_history')).rows[0].n,7);assert.ok((await restored.query('select archived_at from projects where id=$1',[replacement.archivedProjectId])).rows[0].archived_at);assert.equal((await restored.query('select count(*)::int n from uploaded_files f left join property_documents d on d.id=f.property_document_id where d.id is null')).rows[0].n,0);}finally{await restored.close();}
 });
 await writeFile('artifacts/performance-measurements.json',JSON.stringify(timings,null,2));
});
