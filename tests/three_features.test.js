import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import PDFKit from 'pdfkit';
import * as XLSX from 'xlsx';
import { createApp } from '../backend/src/app.js';
import { configuration } from '../backend/src/config.js';
import { initLocalClients } from './localFixture.js';

function createPdfBuffer(text) {
  return new Promise(resolve => {
    const doc = new PDFKit();
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.text(text);
    doc.end();
  });
}

function createCsvBuffer(lines) {
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

test('TASK 1, 2, 3: Full Feature Verification Suite', async (t) => {
  const sentEmails = [];
  let mailerShouldFail = false;

  const config = configuration({
    ...process.env,
    USE_LOCAL_DB: 'true',
    DATABASE_URL: '',
    ADMIN_NOTIFICATION_EMAIL: 'admin.notify@dnassets.com',
    SMTP_HOST: 'smtp.test.local',
    SMTP_PORT: '587',
    SMTP_USER: 'notifier@dnassets.com',
    SMTP_PASSWORD: 'test_password',
    SMTP_FROM: 'DNAssets Test <notifier@dnassets.com>'
  });

  const localClients = await initLocalClients(config);

  t.after(async()=>{await appWithMockMailer.locals.drainUploads();await localClients.dbInstance.close();});
  // Provide mock mailer tracking sent notifications
  const mockMailer = {
    enabled: true,
    async sendMail(opts) {
      if (mailerShouldFail) {
        return { success: false, error: 'Simulated SMTP connection timeout' };
      }
      sentEmails.push(opts);
      return { success: true, messageId: 'msg-' + Date.now() };
    },
    async sendReviewAlert(opts) {
      return this.sendMail(opts);
    },
    async sendReportEmail(opts) {
      return this.sendMail(opts);
    },
    async sendUploadNotification(opts) {
      if (mailerShouldFail) {
        return { success: false, error: 'Simulated SMTP connection timeout' };
      }
      sentEmails.push({ type: 'upload_notification', ...opts });
      return { success: true, messageId: 'upload-msg-' + Date.now() };
    }
  };

  localClients.mailer=mockMailer;
  const app = createApp(config, {
    ...localClients
  });

  // Inject mailer into app if needed or verify through config
  // Let's create an app instance with tracked mailer
  const appWithMockMailer = createApp({
    ...config,
    smtp: {
      ...config.smtp,
      enabled: true,
      adminEmail: 'admin.notify@dnassets.com'
    }
  }, localClients);

  // We can override appWithMockMailer's internal mailer or test mailer methods directly
  let adminToken;
  let userToken;
  let userId;
  const seedPropertyId = '21610000-0000-4000-8000-000000000001';
  let titleDocId;

  // -----------------------------------------------------------
  // AUTHENTICATION & SETUP
  // -----------------------------------------------------------
  await t.test('Authentication: Login admin and standard user', async () => {
    // Admin login
    const adminRes = await request(appWithMockMailer)
      .post('/api/auth/login')
      .send({ email: 'dna.callus@gmail.com', password: 'dna.suresh123' })
      .expect(200);
    adminToken = adminRes.body.access_token;
    assert.ok(adminToken);

    // Standard user login
    const userRes = await request(appWithMockMailer)
      .post('/api/auth/login')
      .send({ email: 'user@dnassets.com', password: 'user123' })
      .expect(200);
    userToken = userRes.body.access_token;
    assert.ok(userToken);

    // Unlock Green Valley project with access password
    const unlockRes = await request(appWithMockMailer)
      .post('/api/projects/11111111-1111-4000-8000-000000000001/unlock')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ password: 'greenvalley123' })
      .expect(200);
    const unlockToken = unlockRes.body.unlock_token;
    assert.ok(unlockToken, 'Must receive unlock token');

    // Verify standard user role is 'user'
    const meRes = await request(appWithMockMailer)
      .get('/api/me')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    assert.equal(meRes.body.role, 'user');
    assert.equal(meRes.body.email, 'user@dnassets.com');
    userId = meRes.body.id;

    // Retrieve property checklist to get a document category id
    const checkRes = await request(appWithMockMailer)
      .get(`/api/properties/${seedPropertyId}/checklist`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('X-Project-Unlock-Token', unlockToken)
      .expect(200);
    assert.ok(checkRes.body.documents.length >= 7);
    titleDocId = checkRes.body.documents[0].id;
  });

  // -----------------------------------------------------------
  // TASK 1: EMAIL NOTIFICATION AND UPLOAD USER TRACKING
  // -----------------------------------------------------------
  let upload1Id;
  await t.test('TASK 1: Standard user upload creates upload_history record and tracks uploader', async () => {
    const pdfBuffer = await createPdfBuffer(
      'Village: Example Village, Taluk: Example Taluk, District: Example District\n' +
      'Survey Nos: 123/1A, 123/1B, and 124/2'
    );

    const uploadRes = await request(appWithMockMailer)
      .post(`/api/properties/${seedPropertyId}/documents/${titleDocId}/files`)
      .set('Authorization', `Bearer ${userToken}`)
      .attach('file', pdfBuffer, 'land_title_deed.pdf')
      .expect(201);
    await appWithMockMailer.locals.drainUploads();

    upload1Id = uploadRes.body.id;
    assert.ok(upload1Id, 'Must receive uploaded file ID');

    // Verify upload history record in database
    const histRes = await request(appWithMockMailer)
      .get('/api/uploads/history')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const record = histRes.body.history.find(h => h.upload_id === upload1Id);
    assert.ok(record, 'Upload history record must exist');
    assert.equal(record.user_id, userId, 'Upload history must associate authenticated user ID');
    assert.equal(record.user_email, 'user@dnassets.com', 'Upload history must record registered email');
    assert.equal(record.original_file_name, 'land_title_deed.pdf');
    assert.ok(record.storage_path.includes(upload1Id) || record.storage_path.length > 0);
    assert.ok(record.upload_timestamp);
    assert.equal(record.processing_status, 'Completed');
    assert.equal(record.associated_survey_numbers, '216/1');
    assert.equal(record.project_id,'11111111-1111-4000-8000-000000000001');
  });

  await t.test('TASK 1: Failed email delivery preserves upload record and marks failure for retry', async () => {
    // When SMTP delivery fails or is skipped, the uploaded file and DB record are preserved
    mailerShouldFail=true;
    const pdfBuffer = await createPdfBuffer('Survey No: 500/1 in Sample Village');

    const uploadRes = await request(appWithMockMailer)
      .post(`/api/properties/${seedPropertyId}/documents/${titleDocId}/files`)
      .set('Authorization', `Bearer ${userToken}`)
      .attach('file', pdfBuffer, 'second_document.pdf')
      .expect(201);
    await appWithMockMailer.locals.drainUploads();

    const upload2Id = uploadRes.body.id;
    assert.ok(upload2Id, 'Upload must succeed even if mailer encounters errors');

    // Verify file and history record are preserved
    const histRes = await request(appWithMockMailer)
      .get('/api/uploads/history')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const record = histRes.body.history.find(h => h.upload_id === upload2Id);
    assert.ok(record, 'Record must be preserved in upload history');
    assert.equal(record.original_file_name, 'second_document.pdf');
    assert.equal(record.email_notification_status,'failed');
    mailerShouldFail=false;
  });

  // -----------------------------------------------------------
  // TASK 2: UPLOADED FILE ANALYSIS AND SURVEY NUMBER SUMMARY
  // -----------------------------------------------------------
  await t.test('TASK 2: Document analysis extracts survey numbers, preserves distinct subdivisions, and computes summary', async () => {
    // Retrieve analysis for the first upload (123/1A, 123/1B, 124/2)
    const analysisRes = await request(appWithMockMailer)
      .get(`/api/analyses/${upload1Id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const { analysis, extracted_surveys } = analysisRes.body;
    assert.ok(analysis, 'Analysis record must exist');
    assert.equal(analysis.status, 'Completed');
    assert.equal(analysis.original_file_name, 'land_title_deed.pdf');

    // Verify counting rules in summary:
    // 3 total entries: 123/1A, 123/1B, 124/2
    // 2 unique main survey numbers: 123 and 124
    // 3 unique survey/subdivision combinations: 123/1A, 123/1B, 124/2
    const summary = analysis.summary;
    assert.equal(summary.total_entries, 3, 'Total entries must be 3');
    assert.equal(summary.unique_main_survey_numbers, 2, 'Main survey numbers must be 2 (123, 124)');
    assert.equal(summary.unique_survey_subdivision_combinations, 3, 'Survey/subdivision combos must be 3');
    assert.equal(summary.successfully_extracted, 3);
    assert.equal(summary.requires_manual_verification, 0);

    // Verify table records
    assert.equal(extracted_surveys.length, 3);
    
    // Check entry 1: 123/1A
    const e1 = extracted_surveys.find(r => r.survey_number === '123' && r.subdivision === '1A');
    assert.ok(e1, '123/1A must be present');
    assert.equal(e1.village, 'Example Village');
    assert.equal(e1.taluk, 'Example Taluk');
    assert.equal(e1.district, 'Example District');
    assert.equal(e1.extent, 'Not Found', 'Missing fields must display Not Found, not invented');
    assert.equal(e1.source_reference, 'Page 1');

    // Check entry 2: 123/1B - distinct from 123/1A
    const e2 = extracted_surveys.find(r => r.survey_number === '123' && r.subdivision === '1B');
    assert.ok(e2, '123/1B must be present and distinct');

    // Check entry 3: 124/2
    const e3 = extracted_surveys.find(r => r.survey_number === '124' && r.subdivision === '2');
    assert.ok(e3, '124/2 must be present');
  });

  await t.test('TASK 2: Spreadsheet (CSV) tabular analysis', async () => {
    const csvBuffer = createCsvBuffer([
      'Survey Number,Sub Division,Village,Taluk,District,Extent',
      '216,1,Green Valley Village,Central Taluk,North District,2.5 Acres',
      '216,2,Green Valley Village,Central Taluk,North District,1.8 Acres',
      '217,1,Green Valley Village,Central Taluk,North District,3.0 Acres'
    ]);

    const uploadRes = await request(appWithMockMailer)
      .post(`/api/properties/${seedPropertyId}/documents/${titleDocId}/files`)
      .set('Authorization', `Bearer ${userToken}`)
      .attach('file', csvBuffer, 'land_schedule.csv')
      .expect(201);
    await appWithMockMailer.locals.drainUploads();

    const csvUploadId = uploadRes.body.id;
    const analysisRes = await request(appWithMockMailer)
      .get(`/api/analyses/${csvUploadId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const { analysis, extracted_surveys } = analysisRes.body;
    assert.equal(analysis.status, 'Completed');
    assert.equal(analysis.summary.total_entries, 3);
    assert.equal(analysis.summary.unique_main_survey_numbers, 2, 'Main numbers 216 and 217');
    assert.equal(analysis.summary.unique_survey_subdivision_combinations, 3);

    const row1 = extracted_surveys.find(r => r.survey_number === '216' && r.subdivision === '1');
    assert.ok(row1);
    assert.equal(row1.extent, '2.5 Acres');
    assert.equal(row1.village, 'Green Valley Village');
  });

  await t.test('TASK 2: Export analysis results in CSV and Excel formats', async () => {
    // CSV export
    const csvExport = await request(appWithMockMailer)
      .get(`/api/analyses/${upload1Id}/export?format=csv`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200)
      .expect('Content-Type', /text\/csv/);
    assert.ok(csvExport.text.includes('123'), 'CSV export must include survey 123');
    assert.ok(csvExport.text.includes('1A'), 'CSV export must include subdivision 1A');

    // Excel export
    const xlsxExport = await request(appWithMockMailer)
      .get(`/api/analyses/${upload1Id}/export?format=xlsx`)
      .set('Authorization', `Bearer ${userToken}`)
      .responseType('blob')
      .expect(200)
      .expect('Content-Type', /spreadsheetml/);
    assert.ok(xlsxExport.body && xlsxExport.body.length > 0, 'Excel export must return valid buffer');
  });

  // -----------------------------------------------------------
  // TASK 3: OTHER TEAMS MUST HAVE ONLY THE USER ROLE
  // -----------------------------------------------------------
  await t.test('TASK 3: Standard user role cannot access admin endpoints or modify roles', async () => {
    // 1. Standard user attempts to list users -> rejected 403
    await request(appWithMockMailer)
      .get('/api/users')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    // 2. Standard user attempts to update another user -> rejected 403
    await request(appWithMockMailer)
      .put(`/api/users/${userId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ role: 'admin' })
      .expect(403);

    // 3. Standard user attempts to manage property members -> rejected 403
    await request(appWithMockMailer)
      .get(`/api/properties/${seedPropertyId}/members`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    await request(appWithMockMailer)
      .post(`/api/properties/${seedPropertyId}/members`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ user_id: userId })
      .expect(403);

    // 4. Standard user updates self profile (name and password allowed)
    const updateSelf = await request(appWithMockMailer)
      .put('/api/me')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ full_name: 'Standard Team User Updated' })
      .expect(200);
    assert.equal(updateSelf.body.full_name, 'Standard Team User Updated');

    // 5. Admin can access admin endpoints
    const adminUsersRes = await request(appWithMockMailer)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    assert.ok(Array.isArray(adminUsersRes.body), 'Admin must be able to list users');
  });

  await t.test('TASK 3: Standard user cannot delete another user document', async () => {
    // Admin uploads a file
    const adminPdf = await createPdfBuffer('Admin private document');
    const adminUploadRes = await request(appWithMockMailer)
      .post(`/api/properties/${seedPropertyId}/documents/${titleDocId}/files`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', adminPdf, 'admin_confidential.pdf')
      .expect(201);
    await appWithMockMailer.locals.drainUploads();

    const adminFileId = adminUploadRes.body.id;

    // Standard user attempts to delete admin's file -> rejected 403
    await request(appWithMockMailer)
      .delete(`/api/files/${adminFileId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    // Admin can delete it successfully
    await request(appWithMockMailer)
      .delete(`/api/files/${adminFileId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
  });
});
