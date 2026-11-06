// Requires explicit test credentials in the process environment. Never logs tokens/passwords.
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { configuration } from '../backend/src/config.js';
import { initFirebaseClients } from '../backend/src/services/firebaseDatabase.js';
const config = configuration({ USE_FIREBASE: 'true' });
const email = process.env.QA_TEST_EMAIL, password = process.env.QA_TEST_PASSWORD;
if (!email || !password) throw new Error('QA_TEST_EMAIL and QA_TEST_PASSWORD are required.');
const app = createApp(config, await initFirebaseClients(config));
const login = await request(app).post('/api/auth/login').send({ email, password });
console.log(JSON.stringify({ route: '/auth/login', status: login.status, error: login.body.error }));
if (login.status !== 200) process.exitCode = 1;
else {
  // A fresh app/client simulates a subsequent request routed to a new serverless worker.
  const nextApp = createApp(config, await initFirebaseClients(config));
  for (const route of ['/me', '/projects', '/properties', '/reports/summary', '/uploads/history?limit=1', '/reviews?limit=1']) {
    const result = await request(nextApp).get('/api' + route).set('Authorization', 'Bearer ' + login.body.access_token);
    console.log(JSON.stringify({ route, status: result.status, error: result.body.error }));
    if (result.status !== 200) process.exitCode = 1;
  }
}
process.exit(process.exitCode || 0);
