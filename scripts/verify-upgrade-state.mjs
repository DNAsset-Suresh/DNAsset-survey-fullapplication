import {PGlite} from '@electric-sql/pglite';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const backup=process.argv[2];
if(!backup)throw Error('Supply the pre-upgrade backup directory. This check reads snapshots without writing them.');
const before=new PGlite({loadDataDir:new Blob([await readFile(backup+'/database/survey_db.tar.gz')])});await before.waitReady;
const currentDb=new PGlite({loadDataDir:new Blob([await readFile('database/survey_db.tar.gz')])});await currentDb.waitReady;
const clients={dbInstance:currentDb};
const report={checkedAt:new Date().toISOString(),backup,tables:{},files:[]};
try {
  for(const table of ['auth.users','profiles','projects','properties','property_documents','uploaded_files','upload_history','document_analyses','extracted_survey_numbers','property_members','project_members','audit_logs','document_categories','storage_cleanup']){
    const rows=(await before.query('select * from '+table)).rows;
    const current=(await clients.dbInstance.query('select * from '+table)).rows;
    assert.equal(current.length,rows.length,table+' row count');
    const key=row=>row.id||row.storage_path||row.property_id+':'+row.user_id||row.project_id+':'+row.user_id;
    // Composite membership keys must use their own parent type.
    const identity=row=>table==='project_members'?row.project_id+':'+row.user_id:table==='property_members'?row.property_id+':'+row.user_id:key(row);
    const byId=new Map(current.map(r=>[identity(r),r]));
    for(const row of rows){const match=byId.get(identity(row));assert.ok(match,table+' identity');for(const column of Object.keys(row))assert.deepEqual(match[column],row[column],table+'.'+column);}
    report.tables[table]={before:rows.length,after:current.length,originalFieldsPreserved:true};
  }
  const files=(await before.query('select storage_path from uploaded_files union select storage_path from storage_cleanup')).rows;
  const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
  for(const file of files){const a=await readFile(backup+'/storage/land-documents/'+file.storage_path);const b=await readFile('storage/land-documents/'+file.storage_path);assert.equal(digest(a),digest(b));report.files.push({path:file.storage_path,sha256:digest(b),unchanged:true});}
  const definition=(await currentDb.query("select pg_get_functiondef('public.survey_delete_preview(uuid,text,uuid)'::regprocedure) as definition")).rows[0].definition;
  assert.ok(definition.includes('Access denied'),'Management migration is installed');
  await writeFile('artifacts/upgrade-data-preservation.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({tablesVerified:Object.keys(report.tables).length,filesVerified:report.files.length,allOriginalFieldsPreserved:true}));
}finally{await clients.dbInstance.close();await before.close();}
