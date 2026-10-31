import assert from 'node:assert/strict';
import request from 'supertest';
import {writeFile} from 'node:fs/promises';
import {initLocalClients} from '../tests/localFixture.js';
import {configuration} from '../backend/src/config.js';
import {createApp} from '../backend/src/app.js';
const config=configuration({USE_LOCAL_DB:'true'}),clients=await initLocalClients(config),app=createApp(config,clients);
try{
 const session=(await request(app).post('/api/auth/login').send({email:'dna.callus@gmail.com',password:'dna.suresh123'}).expect(200)).body;
 const auth={Authorization:'Bearer '+session.access_token};
 const document=(await clients.dbInstance.query("select id from property_documents where property_id='21610000-0000-4000-8000-000000000001' limit 1")).rows[0];
 const file=(await request(app).post(`/api/documents/${document.id}/files`).set(auth).attach('file',Buffer.from('Survey Number\n231\n'),'missing-file-fixture.csv').expect(201)).body;
 await app.locals.drainUploads();
 let link=(await request(app).get(`/api/files/${file.id}/url`).set(auth).expect(200)).body.url;
 const key=link.split('/').pop();clients.signedDownloads.get(key).expires=Date.now()-1;
 await request(app).get(link).expect(404);
 await clients.admin.storage.from(config.bucket).remove([file.storage_path]);
 link=(await request(app).get(`/api/files/${file.id}/url`).set(auth).expect(200)).body.url;
 const missing=await request(app).get(link).expect(404);assert.match(missing.body.message,/missing/i);
 const history=(await request(app).get('/api/uploads/history').set(auth).expect(200)).body.history;
 assert.equal(history.length,1);assert.equal(history[0].upload_id,file.id);
 await writeFile('artifacts/missing-file-verification.json',JSON.stringify({missingFileReturns404:'PASS',expiredDownloadReturns404:'PASS',historyPreserved:'PASS',scope:'Isolated fixture only'},null,2));
 console.log('PASS: missing file, expired link, and retained history.');
}finally{await app.locals.drainUploads();await clients.dbInstance.close();}
