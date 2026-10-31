import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {configuration} from '../backend/src/config.js';
import {initLocalClients} from '../backend/src/services/localDatabase.js';
import {replaceWithPondy} from '../backend/src/services/projectReplacement.js';
const backup=process.argv[2];if(!backup)throw Error('Pass a verified backup directory. Stop the app first.');
const manifest=JSON.parse(await readFile(path.join(backup,'manifest.json'),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
if(!manifest.restoredInMemory||manifest.files.some(f=>!f.verified||!f.sizeMatches))throw Error('Backup integrity verification failed.');
if(hash(await readFile('database/survey_db.tar.gz'))!==manifest.snapshotSha256)throw Error('Database changed since backup; create a new backup first.');
for(const f of manifest.files)if(hash(await readFile(path.join(backup,f.path)))!==f.sha256)throw Error('Backup file hash mismatch.');
const clients=await initLocalClients(configuration({USE_LOCAL_DB:'true'}));
try{
 const db=clients.dbInstance;
 const unrelated=()=>db.query("select jsonb_agg(to_jsonb(p) order by id) as rows from projects p where id<>'11111111-1111-4000-8000-000000000001' and lower(project_name)<>'pondy'");
 const before=JSON.stringify((await unrelated()).rows);
 const historyBefore=(await db.query('select count(*)::int n from upload_history')).rows[0].n;
 const result=await replaceWithPondy(db);
 if(before!==JSON.stringify((await unrelated()).rows))throw Error('Unrelated projects changed.');
 const stats=(await db.query('select (select count(*)::int from property_documents where property_id=$1) as checklist_slots,(select count(*)::int from uploaded_files f join property_documents d on d.id=f.property_document_id where d.property_id=$1) as files,(select count(*)::int from upload_history where project_id=$2) as history',[result.propertyId,result.projectId])).rows[0];
 if(stats.checklist_slots!==7||stats.files||stats.history)throw Error('New project isolation check failed.');
 const historyAfter=(await db.query('select count(*)::int n from upload_history')).rows[0].n;
 if(historyBefore!==historyAfter)throw Error('Historical uploads changed.');
 await clients.flush();
 const report={...result,...stats,unrelatedProjectsUnchanged:true,historyPreserved:historyAfter,backup:path.resolve(backup),completedAt:new Date().toISOString()};
 await writeFile('artifacts/project-replacement.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}finally{await clients.dbInstance.close();}
