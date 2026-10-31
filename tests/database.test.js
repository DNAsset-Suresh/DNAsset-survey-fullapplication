import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let db;
const admin='10000000-0000-4000-8000-000000000001',collector='10000000-0000-4000-8000-000000000002',reviewer='10000000-0000-4000-8000-000000000003',outsider='10000000-0000-4000-8000-000000000004';
const seed='21610000-0000-4000-8000-000000000001';
let title,secondProperty,fileId;
const data={survey_number:'216/1',property_name:'Independent property',village:'Second village',taluk:'',district:'',owner_name:'',land_extent:null,land_extent_unit:'acres',remarks:''};
const metadata=(path='seed/title.pdf')=>({original_file_name:'Title.pdf',storage_path:path,mime_type:'application/pdf',file_size:100});
const scalar=async(sql,params=[])=>Object.values((await db.query(sql,params)).rows[0])[0];
const progress=async(id=seed)=>(await db.query('select * from property_progress where property_id=$1',[id])).rows[0];
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select,insert,update,delete on storage.objects to anon,authenticated;`);
 for(const name of ['001_initial_schema','002_seed_document_categories','003_security_policies','004_transactional_operations'])await db.exec(await readFile(`database/migrations/${name}.sql`,'utf8'));
 for(const [id,role] of [[admin,'admin'],[collector,'collector'],[reviewer,'reviewer'],[outsider,'viewer']]){await db.query('insert into auth.users(id) values($1)',[id]);await db.query('update profiles set role=$2,full_name=$2 where id=$1',[id,role]);}
 title=await scalar('select d.id from property_documents d join document_categories c on c.id=d.document_category_id where d.property_id=$1 and c.display_order=1',[seed]);
});
after(async()=>{await db.close();});
test('216/1 and exactly seven categories are seeded idempotently',async()=>{
 await db.exec(await readFile('database/migrations/002_seed_document_categories.sql','utf8'));
 assert.equal(await scalar('select count(*) from properties'),1);assert.equal(await scalar('select count(*) from property_documents'),7);
 const p=await progress();assert.equal(p.collected,0);assert.equal(p.pending,7);assert.equal(Number(p.collection_percentage),0);
});
test('collection requires uploaded evidence, and reviewers must have property access',async()=>{
 await assert.rejects(db.query('select update_document($1,$2,$3,false)',[admin,title,{is_collected:true}]),/Upload a file/);
 await assert.rejects(db.query('select update_document($1,$2,$3,true)',[reviewer,title,{verification_status:'Verified',survey_match_status:'Matches Survey Number'}]),/Access denied/);
});
test('upload remains unverified; explicit collection yields 14.29%',async()=>{
 fileId=await scalar('select commit_file($1,$2,$3)',[admin,title,metadata()]);
 let p=await progress();assert.equal(p.collected,0);assert.equal(p.verified,0);
 assert.equal(await scalar('select verification_status from property_documents where id=$1',[title]),'Uploaded');
 await db.query('select update_document($1,$2,$3,false)',[admin,title,{is_collected:true}]);
 p=await progress();assert.equal(p.collected,1);assert.equal(Number(p.collection_percentage),14.29);
});
test('assigned reviewer can verify; rejection needs a reason; collection is independent',async()=>{
 await db.query('select manage_member($1,$2,$3)',[admin,seed,reviewer]);
 await assert.rejects(db.query('select update_document($1,$2,$3,true)',[reviewer,title,{verification_status:'Rejected',survey_match_status:'Mismatch Found',rejection_reason:''}]),/Rejection reason/);
 await assert.rejects(db.query('select update_document($1,$2,$3,true)',[reviewer,title,{verification_status:'Verified',survey_match_status:'Mismatch Found'}]),/Confirm the survey/);
 await db.query('select update_document($1,$2,$3,true)',[reviewer,title,{verification_status:'Verified',survey_match_status:'Matches Survey Number',remarks:'Reviewed'}]);
 let p=await progress();assert.equal(Number(p.verification_percentage),14.29);
 await db.query('select update_document($1,$2,$3,false)',[admin,title,{is_collected:false}]);
 p=await progress();assert.equal(Number(p.collection_percentage),0);assert.equal(Number(p.verification_percentage),14.29);
});
test('replacement is atomic, invalidates verification and queues old storage cleanup',async()=>{
 await assert.rejects(db.query('select commit_file($1,$2,$3,$4)',[reviewer,title,metadata('seed/replacement.pdf'),fileId]),/Access denied/);
 await assert.rejects(db.query('select commit_file($1,$2,$3,$4)',[admin,title,{...metadata('bad'),mime_type:'text/html'},fileId]));
 assert.equal(await scalar('select count(*) from uploaded_files where id=$1',[fileId]),1);
 const replacement=await scalar('select commit_file($1,$2,$3,$4)',[admin,title,metadata('seed/replacement.pdf'),fileId]);
 assert.notEqual(replacement,fileId);fileId=replacement;
 assert.equal(await scalar('select count(*) from uploaded_files'),1);
 assert.equal(await scalar('select storage_path from storage_cleanup limit 1'),'seed/title.pdf');
 assert.equal((await progress()).verified,0);
 assert.equal(await scalar("select count(*) from audit_logs where action='file.replaced'"),1);
});
test('multiple files per category; final deletion resets collected state and preserves audit',async()=>{
 const another=await scalar('select commit_file($1,$2,$3)',[admin,title,metadata('seed/extra.pdf')]);
 await db.query('select update_document($1,$2,$3,false)',[admin,title,{is_collected:true}]);
 await assert.rejects(db.query('select remove_file($1,$2)',[reviewer,another]),/Access denied/);
 await db.query('select remove_file($1,$2)',[admin,another]);assert.equal((await progress()).collected,1);
 await db.query('select remove_file($1,$2)',[admin,fileId]);assert.equal((await progress()).collected,0);assert.equal((await progress()).pending,7);
 assert.equal(await scalar('select verification_status from property_documents where id=$1',[title]),'Pending');
 assert.equal(await scalar("select count(*) from audit_logs where action='file.deleted'"),2);
});
test('same survey in another location has independent checklist and progress',async()=>{
 secondProperty=await scalar('select save_property($1,$2)',[collector,data]);
 const p=await progress(secondProperty);assert.equal(p.required,7);assert.equal(p.collected,0);
 assert.equal(await scalar('select count(*) from property_members where property_id=$1 and user_id=$2',[secondProperty,collector]),1);
 await assert.rejects(db.query('select save_property($1,$2)',[collector,data]),/duplicate key/);
 await assert.rejects(db.query('select commit_file($1,$2,$3)',[collector,title,metadata('forbidden')]),/Access denied/);
});
async function asUser(id,fn,role='authenticated'){
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec(`set role ${role}`);
 try{return await fn();}finally{await db.exec('reset role');}
}
test('RLS denies outsiders, isolates collector, permits assigned reviewer and admin',async()=>{
 await asUser(outsider,async()=>{assert.equal(await scalar('select count(*) from properties'),0);assert.equal(await scalar('select count(*) from property_documents'),0);assert.equal(await scalar('select count(*) from property_progress'),0);assert.equal(await scalar('select count(*) from audit_logs'),0);});
 await asUser(collector,async()=>{assert.equal(await scalar('select count(*) from properties'),1);assert.equal(await scalar('select id from properties'),secondProperty);});
 await asUser(reviewer,async()=>{assert.equal(await scalar('select count(*) from properties'),1);assert.equal(await scalar('select id from properties'),seed);assert.equal(await scalar('select full_name from profiles where id=$1',[admin]),'admin');});
 await asUser(admin,async()=>assert.equal(await scalar('select count(*) from properties'),2));
});
test('clients cannot forge mutations, change roles, rewrite audit or access private storage',async()=>{
 await asUser(admin,async()=>{
  await assert.rejects(db.query("update profiles set role='admin' where id=$1",[outsider]),/permission denied/);
  await assert.rejects(db.exec('delete from audit_logs'),/permission denied/);
  await assert.rejects(db.query('select commit_file($1,$2,$3)',[admin,title,metadata('forged')]),/permission denied/);
  await assert.rejects(db.exec("insert into storage.objects(bucket_id,name) values('land-documents','forged.pdf')"),/row-level security/);
 });
 await asUser('',async()=>{await assert.rejects(db.exec('select * from properties'),/permission denied/);assert.equal(await scalar('select count(*) from storage.objects'),0);},'anon');
 assert.equal(await scalar("select public from storage.buckets where id='land-documents'"),false);
});
test('property identity changes reset reviews, with transactional audit',async()=>{
 await scalar('select commit_file($1,$2,$3)',[admin,title,metadata('seed/review.pdf')]);
 await db.query('select update_document($1,$2,$3,true)',[admin,title,{verification_status:'Verified',survey_match_status:'Matches Survey Number'}]);
 await db.query('select save_property($1,$2,$3)',[admin,{...data,survey_number:'216/2',property_name:'',village:''},seed]);
 assert.equal((await progress()).verified,0);
 assert.equal(await scalar("select count(*) from audit_logs where action='property.updated'"),1);
});
test('stored file metadata remains invisible to unassigned users',async()=>{
 await asUser(admin,async()=>assert.equal(await scalar('select count(*) from uploaded_files'),1));
 await asUser(outsider,async()=>assert.equal(await scalar('select count(*) from uploaded_files'),0));
 await asUser(collector,async()=>assert.equal(await scalar('select count(*) from uploaded_files'),0));
 await asUser(reviewer,async()=>assert.equal(await scalar('select count(*) from uploaded_files'),1));
});
