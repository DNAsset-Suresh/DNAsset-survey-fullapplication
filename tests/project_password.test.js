import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../backend/src/app.js';
import { configuration } from '../backend/src/config.js';
import { initLocalClients } from './localFixture.js';

test('Project Access Password: Admin configures password, Reviewer must enter password to see project', async (t) => {
  const config = configuration({
    ...process.env,
    USE_LOCAL_DB: 'true',
    DATABASE_URL: '' // test with embedded PGlite for self-contained isolation
  });

  const localClients = await initLocalClients(config);
  const app = createApp(config, localClients);
  t.after(async()=>{await app.locals.drainUploads();await localClients.dbInstance.close();});

  // 1. Sign in as Admin (Founder)
  const adminRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'dna.callus@gmail.com', password: 'dna.suresh123' })
    .expect(200);
  const adminToken = adminRes.body.access_token;

  // 2. Sign in as Reviewer
  const reviewerRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'reviewer@dnassets.com', password: 'reviewer123' })
    .expect(200);
  const reviewerToken = reviewerRes.body.access_token;

  // 3. Admin creates a password-protected project
  const projectName = 'Silver Oaks ' + Date.now();
  const createRes = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      project_name: projectName,
      project_code: 'SO001',
      description: 'Gated layout with protected survey records',
      access_password: 'silveroaks2026'
    })
    .expect(201);
  const projectId = createRes.body.id;
  await localClients.dbInstance.query('insert into project_members(project_id,user_id)values($1,$2)',[projectId,'10000000-0000-4000-8000-000000000003']);

  // Add a survey number to Silver Oaks
  const createSurveyRes = await request(app)
    .post(`/api/projects/${projectId}/survey-numbers`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      survey_number: '105',
      subdivision_number: '1A',
      village: 'Vadavalli',
      owner_name: 'K. Rajesh'
    })
    .expect(201);
  const surveysCheck = await request(app)
    .get(`/api/projects/${projectId}/survey-numbers`)
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);

  // 4. Admin can view the project and see the access_password
  const adminView = await request(app)
    .get(`/api/projects/${projectId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  assert.equal(adminView.body.project_name, projectName);
  assert.equal(adminView.body.access_password, undefined);
  assert.equal(adminView.body.is_password_protected, true);

  // 5. In projects list, Reviewer sees is_password_protected=true, but access_password is hidden
  const reviewerList = await request(app)
    .get('/api/projects')
    .set('Authorization', `Bearer ${reviewerToken}`)
    .expect(200);
  const pRecord = reviewerList.body.find(p => p.id === projectId);
  assert.ok(pRecord, 'Project must be in list');
  assert.equal(pRecord.is_password_protected, true);
  assert.equal(pRecord.access_password, undefined, 'Raw password must be masked from reviewer');

  // 6. Reviewer tries to view project without password -> 403 Forbidden
  const blockedView = await request(app)
    .get(`/api/projects/${projectId}`)
    .set('Authorization', `Bearer ${reviewerToken}`)
    .expect(403);
  assert.match(blockedView.body.message, /password-protected/i);

  // 7. Reviewer tries to view matrix without password -> 403 Forbidden
  const blockedMatrix = await request(app)
    .get(`/api/projects/${projectId}/matrix`)
    .set('Authorization', `Bearer ${reviewerToken}`)
    .expect(403);
  assert.match(blockedMatrix.body.message, /password-protected/i);

  // 8. Reviewer enters wrong password -> 403 Forbidden
  const wrongUnlock = await request(app)
    .post(`/api/projects/${projectId}/unlock`)
    .set('Authorization', `Bearer ${reviewerToken}`)
    .send({ password: 'wrongpassword' })
    .expect(403);
  assert.match(wrongUnlock.body.message, /incorrect/i);

  // 9. Reviewer enters correct password -> 200 with unlock_token
  const unlockRes = await request(app)
    .post(`/api/projects/${projectId}/unlock`)
    .set('Authorization', `Bearer ${reviewerToken}`)
    .send({ password: 'silveroaks2026' })
    .expect(200);
  assert.equal(unlockRes.body.success, true);
  assert.ok(unlockRes.body.unlock_token, 'Must return unlock token');
  const unlockToken = unlockRes.body.unlock_token;

  // 10. Reviewer views project with unlock token -> 200 OK
  const allowedView = await request(app)
    .get(`/api/projects/${projectId}`)
    .set('Authorization', `Bearer ${reviewerToken}`)
    .set('X-Project-Unlock-Token', unlockToken)
    .expect(200);
  assert.equal(allowedView.body.project_name, projectName);
  assert.equal(allowedView.body.is_unlocked, true);

  // 11. Reviewer views matrix with unlock token -> 200 OK
  const allowedMatrix = await request(app)
    .get(`/api/projects/${projectId}/matrix`)
    .set('Authorization', `Bearer ${reviewerToken}`)
    .set('X-Project-Unlock-Token', unlockToken)
    .expect(200);
  assert.equal(allowedMatrix.body.project.project_name, projectName);
  assert.equal(allowedMatrix.body.survey_checklists.length, 1);
});
