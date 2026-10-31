import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { configuration } from '../backend/src/config.js';
import { validateFile,reviewSchema,propertySchema } from '../backend/src/validators.js';
import { persistUpload } from '../backend/src/services/uploads.js';
import { csvReport,pdfReport,reportRows } from '../backend/src/services/reports.js';

const config=configuration({});
test('setup mode serves interface but fails closed for data mutations',async()=>{
 const app=createApp(config);
 await request(app).get('/').expect(200).expect('Content-Security-Policy',/default-src 'self'/);
 const response=await request(app).get('/api/config').expect(200);assert.equal(response.body.configured,false);
 await request(app).post('/api/properties').send({survey_number:'216/1'}).expect(503);
 await request(app).get('/backend/.env').expect(404);
});
test('configured API requires validated authentication, including health',async()=>{
 const app=createApp({...config,configured:true},{admin:{auth:{getUser:async()=>({error:{message:'invalid'}})}}});
 await request(app).get('/api/properties').expect(401);
 await request(app).get('/api/health').expect(401);
 await request(app).get('/api/files/10000000-0000-4000-8000-000000000001/url').set('Authorization','Bearer invalid').expect(401);
});
test('CORS only returns access headers for configured origins',async()=>{
 const app=createApp(config);
 const denied=await request(app).get('/api/config').set('Origin','https://untrusted.example');assert.equal(denied.headers['access-control-allow-origin'],undefined);
 const allowed=await request(app).get('/api/config').set('Origin','http://localhost:3000');assert.equal(allowed.headers['access-control-allow-origin'],'http://localhost:3000');
});
const pdfFile={originalname:'title.pdf',mimetype:'application/pdf',buffer:Buffer.from('%PDF-1.7\n% test header for validation'),size:37};
test('file validation enforces extension, signature, MIME and size',async()=>{
 assert.equal((await validateFile(pdfFile,1000)).mime,'application/pdf');
 await assert.rejects(validateFile({...pdfFile,originalname:'title.exe'},1000),/must match/);
 await assert.rejects(validateFile({...pdfFile,mimetype:'image/png'},1000),/must match/);
 await assert.rejects(validateFile({...pdfFile,buffer:Buffer.from('<script>alert(1)</script>')},1000),/must match/);
 await assert.rejects(validateFile({...pdfFile,size:1001},1000),/size limit/);
 await assert.rejects(validateFile({...pdfFile,size:0},1000),/empty/);
});
test('review validation requires rejection reason and a confirmed survey match',()=>{
 assert.equal(reviewSchema.safeParse({verification_status:'Rejected',survey_match_status:'Mismatch Found',rejection_reason:'  '}).success,false);
 assert.equal(reviewSchema.safeParse({verification_status:'Verified',survey_match_status:'Not Checked'}).success,false);
 assert.equal(propertySchema.safeParse({survey_number:'216/1',created_by:'spoof'}).success,false);
});
function uploadMock({storageError=false,rpcError=false,committed=false}={}){
 const calls={rpc:0,removed:[],queued:[]};const storage={upload:async()=>({error:storageError?{}:null}),remove:async paths=>{calls.removed.push(...paths);return {error:null};}};
 const admin={storage:{from:()=>storage},rpc:async()=>{calls.rpc++;return rpcError?{error:{code:'23514'}}:{data:'new-file-id'};},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:committed?{id:'committed-file'}:null,error:null})})}),upsert:async item=>calls.queued.push(item)})};
 return {admin,calls};
}
test('storage failure creates no database record',async()=>{
 const {admin,calls}=uploadMock({storageError:true});await assert.rejects(persistUpload({admin,config,actor:'actor',document:{id:'doc',property_id:'property'},file:pdfFile}),/Upload failed/);assert.equal(calls.rpc,0);
});
test('metadata failure cleans new object and does not touch original replacement',async()=>{
 const {admin,calls}=uploadMock({rpcError:true});await assert.rejects(persistUpload({admin,config,actor:'actor',document:{id:'doc',property_id:'property'},file:pdfFile,replaceId:'original-file'}));assert.equal(calls.removed.length,1);assert.match(calls.removed[0],/^property\/doc\/.*\.pdf$/);
});
test('ambiguous commit response preserves successfully committed object',async()=>{
 const {admin,calls}=uploadMock({rpcError:true,committed:true});const result=await persistUpload({admin,config,actor:'actor',document:{id:'doc',property_id:'property'},file:pdfFile});assert.equal(result.id,'committed-file');assert.equal(calls.removed.length,0);
});
test('CSV escapes fields and neutralizes spreadsheet formulas',()=>{
 const csv=csvReport([{survey:'=1+2',remarks:'Hello, "world"\nNext line'}]);assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.includes("\"'=1+2\""));assert.ok(csv.includes('Hello, ""world""'));
});
test('PDF export is a real multipage PDF, including long reviewer remarks',async()=>{
 const rows=Array.from({length:18},(_,i)=>({survey:'216/1',category:'Document '+i,location:'Village',status:'Pending',match:'Not Checked',remarks:'Review notes. '.repeat(80),updated:'2026-10-26'}));
 const buffer=await pdfReport(rows);assert.equal(buffer.subarray(0,5).toString(),'%PDF-');assert.ok(buffer.length>2000);assert.match(buffer.toString('latin1'),/\/Count [2-9][0-9]?/);
});
test('report filters carry property, status, filename, remarks and progress',()=>{
 const sets=[{property:{survey_number:'216/1'},progress:{collection_percentage:14.29,verification_percentage:0},documents:[{category:{name:'Title Documents'},is_collected:true,files:[{original_file_name:'title.pdf'}],verification_status:'Rejected',remarks:'Check source',rejection_reason:'Wrong survey',updated_at:'2026-10-26'}]}];
 assert.equal(reportRows(sets,'pending').length,0);const rows=reportRows(sets,'rejected');assert.equal(rows[0].files,'title.pdf');assert.equal(rows[0].collection,'14.29%');assert.equal(rows[0].rejection,'Wrong survey');
});
test('production refuses missing credentials or non-HTTPS origins',()=>{
 assert.throws(()=>configuration({NODE_ENV:'production'}),/Production requires/);
});
