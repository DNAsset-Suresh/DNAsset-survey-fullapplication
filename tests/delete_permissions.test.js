import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {configuration} from '../backend/src/config.js';
import {createApp} from '../backend/src/app.js';
import {initLocalClients} from './localFixture.js';
import {renderChecklist} from '../frontend/js/checklist.js';

test('Delete permissions: roles, ownership, UI, and database enforcement', async t => {
  const config=configuration({USE_LOCAL_DB:'true'});
  const clients=await initLocalClients(config), db=clients.dbInstance, app=createApp(config,clients);
  t.after(async()=>{await app.locals.drainUploads();await db.close();});
  const property='21610000-0000-4000-8000-000000000001';
  const accounts={};
  for(const [role,email,password] of [
    ['admin','dna.callus@gmail.com','dna.suresh123'],
    ['reviewer','reviewer@dnassets.com','reviewer123'],
    ['user','user@dnassets.com','user123'],
    ['viewer','viewer@dnassets.com','viewer123']
  ]) {
    const login=await request(app).post('/api/auth/login').send({email,password}).expect(200);
    const headers={Authorization:'Bearer '+login.body.access_token};
    const me=await request(app).get('/api/me').set(headers).expect(200);
    if(role!=='admin') {
      const unlock=await request(app).post('/api/projects/11111111-1111-4000-8000-000000000001/unlock').set(headers).send({password:'greenvalley123'}).expect(200);
      headers['X-Project-Unlock-Token']=unlock.body.unlock_token;
    }
    accounts[role]={headers,profile:me.body};
  }
  const checklist=await request(app).get(`/api/properties/${property}/checklist`).set(accounts.admin.headers).expect(200);
  const document=checklist.body.documents[0].id;
  const upload=async role=>{
    const result=await request(app).post(`/api/documents/${document}/files`).set(accounts[role].headers).attach('file',Buffer.from('Survey Number\n216\n'),role+'.csv').expect(201);
    await app.locals.drainUploads();return result.body.id;
  };
  const userFile=await upload('user'), reviewerFile=await upload('reviewer');
  await t.test('File content requires authentication and returns the original bytes',async()=>{
    await request(app).get(`/api/files/${userFile}/content`).expect(401);
    const content=await request(app).get(`/api/files/${userFile}/content`).set(accounts.user.headers).expect(200);
    assert.equal(content.text,'Survey Number\n216\n');
    assert.equal(decodeURIComponent(content.headers['x-file-name']),'user.csv');
    await request(app).get('/api/storage/download/untrusted-path').expect(404);
  });
  const data=(await request(app).get(`/api/properties/${property}/checklist`).set(accounts.admin.headers).expect(200)).body;
  await t.test('Delete buttons follow roles and reviewer ownership',()=>{
    for(const role of ['user','viewer','collector']) {
      const html=renderChecklist(data,{profile:{...accounts.user.profile,role},config:{maxFileBytes:1048576}});
      assert.ok(!html.includes('data-delete='));
    }
    const reviewerHtml=renderChecklist(data,{profile:accounts.reviewer.profile,config:{maxFileBytes:1048576}});
    assert.ok(reviewerHtml.includes(`data-delete="${reviewerFile}"`));
    assert.ok(!reviewerHtml.includes(`data-delete="${userFile}"`));
    const adminHtml=renderChecklist(data,{profile:accounts.admin.profile,config:{maxFileBytes:1048576}});
    assert.ok(adminHtml.includes(`data-delete="${userFile}"`));
    assert.ok(!renderChecklist({...data,property:{...data.property,project_archived_at:'2026-10-30'}},{profile:accounts.admin.profile,config:{maxFileBytes:1048576}}).includes('data-delete='));
  });
  await t.test('Team User and Viewer cannot delete, including own uploads',async()=>{
    for(const role of ['user','viewer']) {
      await request(app).delete(`/api/files/${userFile}`).set(accounts[role].headers).expect(403);
      await assert.rejects(db.query('select public.remove_file($1,$2)',[accounts[role].profile.id,userFile]),/Access denied/);
    }
  });
  await t.test('Reviewer retains ownership restriction but can delete own upload',async()=>{
    await request(app).delete(`/api/files/${userFile}`).set(accounts.reviewer.headers).expect(403);
    await assert.rejects(db.query('select public.remove_file($1,$2)',[accounts.reviewer.profile.id,userFile]),/another user/);
    await request(app).delete(`/api/files/${reviewerFile}`).set(accounts.reviewer.headers).expect(204);
  });
  await t.test('Founder with admin role can delete another user upload; history retained',async()=>{
    await request(app).delete(`/api/files/${userFile}`).set(accounts.admin.headers).expect(204);
    const rows=(await db.query('select upload_id,removed_at from upload_history where original_upload_id in ($1,$2)',[userFile,reviewerFile])).rows;
    assert.equal(rows.length,2);assert.ok(rows.every(r=>r.upload_id===null&&r.removed_at));
  });
});
