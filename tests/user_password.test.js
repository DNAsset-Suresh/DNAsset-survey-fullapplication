import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { configuration } from '../backend/src/config.js';
import { initLocalClients } from './localFixture.js';

test('User Profile & Password: User and Admin can change name and password', async (t) => {
  const config = configuration({
    ...process.env,
    USE_LOCAL_DB: 'true',
    DATABASE_URL: '' // self-contained isolated DB
  });

  const localClients = await initLocalClients(config);
  const app = createApp(config, localClients);
  t.after(async()=>{await app.locals.drainUploads();await localClients.dbInstance.close();});

  // 1. Reviewer signs in with initial password
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'reviewer@dnassets.com', password: 'reviewer123' })
    .expect(200);
  const reviewerToken = loginRes.body.access_token;
  assert.ok(reviewerToken, 'Must receive reviewer access token');

  // 2. Reviewer views self profile
  const meRes = await request(app)
    .get('/api/me')
    .set('Authorization', `Bearer ${reviewerToken}`)
    .expect(200);
  assert.equal(meRes.body.email, 'reviewer@dnassets.com');
  assert.equal(meRes.body.role, 'reviewer');
  const reviewerId = meRes.body.id;

  // 3. Reviewer updates their name and password
  const updateRes = await request(app)
    .put('/api/me')
    .set('Authorization', `Bearer ${reviewerToken}`)
    .send({ full_name: 'Suresh Reviewer', password: 'newreviewer456' })
    .expect(200);
  assert.equal(updateRes.body.full_name, 'Suresh Reviewer');

  // 4. Old password should now fail
  await request(app)
    .post('/api/auth/login')
    .send({ email: 'reviewer@dnassets.com', password: 'reviewer123' })
    .expect(401);

  // 5. New password succeeds
  const newLoginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'reviewer@dnassets.com', password: 'newreviewer456' })
    .expect(200);
  assert.ok(newLoginRes.body.access_token);

  // 6. Admin lists users
  const adminLoginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'dna.callus@gmail.com', password: 'dna.suresh123' })
    .expect(200);
  const adminToken = adminLoginRes.body.access_token;

  const usersListRes = await request(app)
    .get('/api/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  assert.ok(Array.isArray(usersListRes.body));
  const foundUser = usersListRes.body.find(u => u.id === reviewerId);
  assert.ok(foundUser);
  assert.equal(foundUser.full_name, 'Suresh Reviewer');

  // 7. Admin resets Reviewer name and password
  const adminUpdateRes = await request(app)
    .put(`/api/users/${reviewerId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ full_name: 'Verified Legal Reviewer', password: 'adminreset789' })
    .expect(200);
  assert.equal(adminUpdateRes.body.full_name, 'Verified Legal Reviewer');

  // 8. Sign in with admin-reset password succeeds
  const resetLoginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'reviewer@dnassets.com', password: 'adminreset789' })
    .expect(200);
  assert.ok(resetLoginRes.body.access_token);

  // 9. Login cannot overwrite the recorded identity; use authenticated profile settings.
  const nameLoginRes = await request(app)
    .post('/api/auth/login')
    .send({ full_name: 'Lead Site Reviewer', email: 'reviewer@dnassets.com', password: 'adminreset789' })
    .expect(200);
  assert.ok(nameLoginRes.body.access_token);

  const meCheckRes = await request(app)
    .get('/api/me')
    .set('Authorization', `Bearer ${nameLoginRes.body.access_token}`)
    .expect(200);
  assert.equal(meCheckRes.body.full_name, 'Verified Legal Reviewer');

  // 10. Reviewer can also sign in with username alias "reviewer"
  const aliasLoginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'reviewer', password: 'adminreset789' })
    .expect(200);
  assert.ok(aliasLoginRes.body.access_token);
});
