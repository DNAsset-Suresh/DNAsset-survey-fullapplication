import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {readFile,mkdtemp,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {configuration} from '../backend/src/config.js';
import {createApp} from '../backend/src/app.js';
import {initLocalClients} from './localFixture.js';

test('Tracking, scoped deletion and reset safeguards',async t=>{
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const original=hash(await readFile('database/survey_db.tar.gz'));
  const backups=await mkdtemp(path.resolve('artifacts/management-backup-'));
  const config=configuration({USE_LOCAL_DB:'true',SURVEY_BACKUP_DIRECTORY:backups});
  const clients=await initLocalClients(config),db=clients.dbInstance,app=createApp(config,clients);
  t.after(async()=>{await app.locals.drainUploads();await db.close();await rm(backups,{recursive:true,force:true});assert.equal(hash(await readFile('database/survey_db.tar.gz')),original);});
  const accounts={};
  for(const [role,email,password] of [['admin','dna.callus@gmail.com','dna.suresh123'],['reviewer','reviewer@dnassets.com','reviewer123'],['user','user@dnassets.com','user123'],['viewer','viewer@dnassets.com','viewer123']]){
    const s=await request(app).post('/api/auth/login').send({email,password}).expect(200);
    const headers={Authorization:'Bearer '+s.body.access_token};const me=await request(app).get('/api/me').set(headers).expect(200);accounts[role]={headers,id:me.body.id};
  }
  const admin=accounts.admin.headers;
  const createProject=async name=>(await request(app).post('/api/projects').set(admin).send({project_name:name}).expect(201)).body.id;
  const createSurvey=async(project,number)=>(await request(app).post(`/api/projects/${project}/survey-numbers`).set(admin).send({survey_number:number}).expect(201)).body.id;
  const checklist=async id=>(await request(app).get(`/api/properties/${id}/checklist`).set(admin).expect(200)).body;
  const upload=async(document,role='user')=>{const r=await request(app).post(`/api/documents/${document}/files`).set(accounts[role].headers).attach('file',Buffer.from('Survey Number\n231\n'),'231.csv').expect(201);await app.locals.drainUploads();return r.body.id;};
  const preview=async(scope,id=null)=>(await request(app).post('/api/management/preview').set(admin).send({scope,id}).expect(200)).body;
  const execute=async plan=>request(app).post('/api/management/execute').set(admin).send({token:plan.token,phrase:plan.phrase,confirmed:true});
  const project=await createProject('Tracking A'),other=await createProject('Unrelated B');
  await request(app).delete(`/api/projects/${project}`).set(admin).expect(409);
  const survey=await createSurvey(project,'231'),sibling=await createSurvey(project,'232'),otherSurvey=await createSurvey(other,'999');
  for(const role of ['reviewer','user','viewer'])await db.query('insert into property_members(property_id,user_id) values($1,$2)',[survey,accounts[role].id]);
  const doc=(await checklist(survey)).documents[0].id;
  let file,second;
  await t.test('Uploader identity is session-derived and login cannot rename another account',async()=>{
    await request(app).post('/api/auth/login').send({email:'user@dnassets.com',password:'user123',full_name:'Impersonated Admin'}).expect(200);
    file=await upload(doc);
    const h=(await request(app).get('/api/uploads/history').set(accounts.user.headers).expect(200)).body.history.find(h=>h.upload_id===file);
    assert.equal(h.user_id,accounts.user.id);assert.equal(h.user_name,'user');assert.equal(h.project_name,'Tracking A');assert.equal(h.survey_number,'231');assert.ok(h.document_name);assert.ok(Date.parse(h.upload_timestamp));
  });
  await t.test('Verified, rejected and pending actions retain reviewer identity, time and remarks',async()=>{
    const body={verification_status:'Verified',survey_match_status:'Matches Survey Number',remarks:'Reviewed original record'};
    await request(app).post(`/api/documents/${doc}/verification`).set(accounts.user.headers).send(body).expect(403);
    await request(app).post(`/api/documents/${doc}/verification`).set(accounts.reviewer.headers).send({...body,reviewer_id:accounts.admin.id}).expect(400);
    for(const [status,remarks,reason] of [['Verified','Reviewed original record',''],['Rejected','Mismatch found','Needs corrected record'],['Pending','Awaiting clarification','']]){
      await request(app).post(`/api/documents/${doc}/verification`).set(accounts.reviewer.headers).send({...body,verification_status:status,remarks,rejection_reason:reason}).expect(200);
    }
    const rows=(await request(app).get(`/api/reviews?document_id=${doc}`).set(accounts.reviewer.headers).expect(200)).body.rows;
    assert.equal(rows.length,3);assert.ok(rows.every(r=>r.reviewer_id===accounts.reviewer.id&&r.reviewer_name==='reviewer'&&Date.parse(r.reviewed_at)&&r.upload_ids.includes(file)&&r.ip_address));
    const h=(await request(app).get('/api/uploads/history?project=Tracking&survey=231&uploader=user&reviewer=reviewer&status=Pending').set(accounts.reviewer.headers).expect(200)).body;
    assert.equal(h.total,1);assert.equal(h.history[0].review_remarks,'Awaiting clarification');assert.equal(h.history[0].reviewer_name,'reviewer');
    await db.query("update profiles set full_name='Renamed reviewer' where id=$1",[accounts.reviewer.id]);
    assert.equal((await request(app).get(`/api/reviews?document_id=${doc}`).set(admin)).body.rows[0].reviewer_name,'reviewer');
    // Older records may already include their subdivision in survey_number.
    await db.query("update properties set survey_number='231/1',subdivision_number='1' where id=$1",[survey]);
    await request(app).post(`/api/documents/${doc}/verification`).set(accounts.reviewer.headers).send({...body,verification_status:'Pending'}).expect(200);
    assert.equal((await request(app).get(`/api/reviews?document_id=${doc}`).set(admin)).body.rows[0].survey_number,'231/1');
    await db.query("update properties set survey_number='231',subdivision_number='' where id=$1",[survey]);
  });
  await t.test('History filters, own-history isolation, exports and protected project unlock',async()=>{
    second=await upload(doc,'admin');
    const own=(await request(app).get('/api/uploads/history').set(accounts.user.headers).expect(200)).body;
    assert.equal(own.total,1);assert.equal(own.history[0].upload_id,file);
    assert.equal((await request(app).get('/api/uploads/history?from=2099-01-01').set(admin).expect(200)).body.total,0);
    await request(app).get('/api/uploads/history?from=2026-12-31&to=2026-01-01').set(admin).expect(400);
    const csv=await request(app).get('/api/uploads/history/export?format=csv&uploader=user').set(accounts.reviewer.headers).expect(200);
    assert.match(csv.text,/Reviewed By/);assert.match(csv.text,/Tracking A/);
    await request(app).get('/api/uploads/history/export?format=xlsx').set(admin).expect(200).expect('Content-Type',/spreadsheetml/);
    await db.query("update projects set access_password='locked' where id=$1",[project]);
    assert.equal((await request(app).get('/api/uploads/history').set(accounts.reviewer.headers).expect(200)).body.total,0);
    await request(app).post(`/api/projects/${project}/unlock`).set(accounts.reviewer.headers).send({password:'locked'}).expect(200);
    assert.equal((await request(app).get('/api/uploads/history').set(accounts.reviewer.headers).expect(200)).body.total,2);
    await db.query("update projects set access_password='' where id=$1",[project]);
  });
  await t.test('Audit records include identities, review outcomes and IP, and cannot be edited',async()=>{
    const rows=(await request(app).get('/api/audit').set(admin).expect(200)).body.rows;
    for(const action of ['project.created','property.created','file.uploaded','document.verified','document.rejected','document.reviewed'])assert.ok(rows.some(r=>r.action===action),action);
    assert.ok(rows.filter(r=>r.project_id===project).every(r=>r.actor_id&&r.actor_name&&r.actor_role&&r.ip_address));
    await assert.rejects(db.query("update audit_logs set description='tampered'"),/append-only/);
    await request(app).get('/api/audit').set(accounts.reviewer.headers).expect(403);
  });
  await t.test('Admin archive is reversible; archived projects reject changes',async()=>{
    await request(app).post(`/api/management/projects/${project}/archive`).set(accounts.reviewer.headers).send({archived:true}).expect(403);
    await request(app).post(`/api/management/projects/${project}/archive`).set(admin).send({archived:true}).expect(200);
    await request(app).post(`/api/documents/${doc}/verification`).set(admin).send({verification_status:'Pending',survey_match_status:'Not Checked'}).expect(409);
    await request(app).post(`/api/management/projects/${project}/archive`).set(admin).send({archived:false}).expect(200);
  });
  await t.test('Delete/reset require admin role, exact phrase, second confirmation, session token and unchanged data',async()=>{
    for(const role of ['user','viewer','reviewer'])for(const scope of ['all','reset','project','survey'])await request(app).post('/api/management/preview').set(accounts[role].headers).send({scope,id:survey}).expect(403);
    const plan=await preview('all');
    await request(app).post('/api/management/execute').set(admin).send({token:plan.token,phrase:plan.phrase}).expect(400);
    await request(app).post('/api/management/execute').set(admin).send({token:plan.token,phrase:'WRONG',confirmed:true}).expect(400);
    await request(app).post('/api/management/execute').set(accounts.user.headers).send({token:plan.token,phrase:plan.phrase,confirmed:true}).expect(403);
    const otherLogin=(await request(app).post('/api/auth/login').send({email:'dna.callus@gmail.com',password:'dna.suresh123'}).expect(200)).body.access_token;
    await request(app).post('/api/management/execute').set('Authorization','Bearer '+otherLogin).send({token:plan.token,phrase:plan.phrase,confirmed:true}).expect(409);
    await createSurvey(other,'1000');await execute(plan).then(r=>assert.equal(r.status,409));
    assert.ok((await checklist(survey)).documents.length);
  });
  await t.test('Backup failure stops deletion without touching records or files',async()=>{
    const plan=await preview('survey',survey),storage=clients.admin.storage.from;
    clients.admin.storage.from=bucket=>({...storage(bucket),download:async()=>({error:new Error('simulated unavailable file')})});
    try {await execute(plan).then(r=>assert.equal(r.status,503));}finally{clients.admin.storage.from=storage;}
    assert.equal((await checklist(survey)).documents[0].files.length,2);
  });
  await t.test('Survey deletion is isolated, backs up data and files, preserves history and retries storage failures',async()=>{
    const before=await checklist(sibling),plan=await preview('survey',survey),storage=clients.admin.storage.from;
    clients.admin.storage.from=bucket=>({...storage(bucket),remove:async()=>({error:new Error('temporary storage failure')})});
    let response;try{response=await execute(plan);assert.equal(response.status,200,JSON.stringify(response.body));}finally{clients.admin.storage.from=storage;}
    assert.equal(response.body.storage.pending,2);assert.equal(response.body.projects,0);assert.equal(response.body.surveys,1);
    assert.deepEqual(await checklist(sibling),before);
    const manifest=JSON.parse(await readFile(path.join(response.body.backupPath,'manifest.json')));assert.ok(manifest.files.length>=2);
    const restore=new PGlite({loadDataDir:new Blob([await readFile(path.join(response.body.backupPath,'survey_db.tar.gz'))])});await restore.waitReady;
    assert.equal((await restore.query('select count(*)::int n from uploaded_files where id in($1,$2)',[file,second])).rows[0].n,2);await restore.close();
    const retry=await request(app).post(`/api/management/storage/${response.body.operation_id}/retry`).set(admin).expect(200);assert.equal(retry.body.pending,0);
    const h=(await request(app).get('/api/uploads/history?project=Tracking').set(admin).expect(200)).body.history;assert.equal(h.length,2);assert.ok(h.every(h=>h.removed_at&&!h.upload_id));
    assert.equal((await request(app).get(`/api/reviews?document_id=${doc}`).set(admin)).body.rows.length,4);
    await execute(plan).then(r=>assert.equal(r.status,409));
  });
  await t.test('Selected project deletion preserves unrelated project records exactly',async()=>{
    const before=(await db.query('select * from properties where project_id=$1 order by id',[other])).rows;
    const plan=await preview('project',project);await execute(plan).then(r=>assert.equal(r.status,200,JSON.stringify(r.body)));
    assert.deepEqual((await db.query('select * from properties where project_id=$1 order by id',[other])).rows,before);
    assert.equal((await db.query('select count(*)::int n from projects where id=$1',[project])).rows[0].n,0);
  });
  await t.test('Database transaction failure rolls back deletion and its audit events',async()=>{
    await db.exec("create function private.fail_delete_test() returns trigger language plpgsql as $$begin raise exception 'Injected failure';end$$; create trigger fail_delete_test before delete on public.properties for each row execute function private.fail_delete_test();");
    const before=(await db.query('select count(*)::int n from audit_logs')).rows[0].n;
    try{await execute(await preview('all')).then(r=>assert.equal(r.status,502));}finally{await db.exec('drop trigger fail_delete_test on public.properties; drop function private.fail_delete_test();');}
    assert.equal((await db.query('select count(*)::int n from audit_logs')).rows[0].n,before);await checklist(otherSurvey);
  });
  await t.test('Delete all preserves permanent histories and accounts; reset preserves audit, company data and schema',async()=>{
    const users=(await db.query('select * from auth.users order by id')).rows,profiles=(await db.query('select * from profiles order by id')).rows;
    await db.exec("create table public.company_reference(id int primary key,label text);insert into public.company_reference values(1,'Keep company data');");
    await execute(await preview('all')).then(r=>assert.equal(r.status,200,JSON.stringify(r.body)));
    assert.equal((await db.query('select count(*)::int n from projects')).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from upload_history')).rows[0].n,2);
    const priorAudit=(await db.query('select id from audit_logs order by id')).rows.map(r=>r.id);
    await execute(await preview('reset')).then(r=>assert.equal(r.status,200,JSON.stringify(r.body)));
    for(const table of ['projects','properties','property_documents','uploaded_files','upload_history','document_reviews','document_analyses','extracted_survey_numbers'])assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n,0,table);
    assert.deepEqual((await db.query('select * from auth.users order by id')).rows,users);assert.deepEqual((await db.query('select * from profiles order by id')).rows,profiles);
    assert.equal((await db.query('select label from company_reference')).rows[0].label,'Keep company data');assert.equal((await db.query('select count(*)::int n from document_categories')).rows[0].n,7);
    const audit=(await request(app).get('/api/audit?limit=100').set(admin).expect(200)).body.rows;assert.ok(audit.some(a=>a.action==='database.reset'));
    const ids=new Set((await db.query('select id from audit_logs')).rows.map(r=>r.id));assert.ok(priorAudit.every(id=>ids.has(id)));
    const fresh=await createProject('After reset');assert.equal((await checklist(await createSurvey(fresh,'1'))).documents.length,7);
  });
});
