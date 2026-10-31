import { PGlite } from '@electric-sql/pglite';
import { readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(process.argv[2] || `backups/local-${new Date().toISOString().replace(/[:.]/g,'-')}`);
await mkdir(root, { recursive: true });
await cp('database/survey_db.tar.gz', path.join(root, 'survey_db.tar.gz'), { errorOnExist: true, force: false });
await cp('storage', path.join(root, 'storage'), { recursive: true, errorOnExist: true, force: false });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const db = new PGlite({ loadDataDir: new Blob([await readFile(path.join(root,'survey_db.tar.gz'))]) });
await db.waitReady;
const id = '11111111-1111-4000-8000-000000000001';
const project = (await db.query('select id,project_name,project_code,status from projects where id=$1', [id])).rows[0];
if (!project || !/^green\s*valley$/i.test(project.project_name)) throw Error('Expected Green Valley was not found. No data changed.');
const documents = (await db.query('select f.* from uploaded_files f join property_documents d on d.id=f.property_document_id join properties p on p.id=d.property_id where p.project_id=$1',[id])).rows;
const files = [];
for (const f of documents) {
  const relative = path.join('storage','land-documents',f.storage_path);
  try {
    const original = await readFile(relative), copy = await readFile(path.join(root,relative));
    files.push({id:f.id,path:relative,bytes:copy.length,metadataBytes:Number(f.file_size),sha256:hash(copy),verified:hash(original)===hash(copy),sizeMatches:copy.length===Number(f.file_size)});
  } catch(err) { files.push({id:f.id,path:relative,missing:true,error:err.code}); }
}
const counts = {};
for(const table of ['projects','properties','property_documents','uploaded_files','upload_history','document_analyses','extracted_survey_numbers','property_members','project_members','audit_logs']) counts[table] = (await db.query(`select count(*)::int as count from ${table}`)).rows[0].count;
const integrity = (await db.query('select count(*)::int as count from uploaded_files f left join property_documents d on d.id=f.property_document_id where d.id is null')).rows[0].count;
const manifest = {createdAt:new Date().toISOString(),source:'Saved local snapshot, not the cloud database',project,counts,files,restoredInMemory:true,orphanFileReferences:integrity,snapshotSha256:hash(await readFile(path.join(root,'survey_db.tar.gz')))};
await writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2));
await db.close();
console.log(JSON.stringify({backup:root,...manifest},null,2));
