import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let db;
const admin = '10000000-0000-4000-8000-000000000001';
const reviewer = '10000000-0000-4000-8000-000000000003';
const greenValleyId = '11111111-1111-4000-8000-000000000001';
const survey216_1 = '21610000-0000-4000-8000-000000000001';
const survey216_2 = '21620000-0000-4000-8000-000000000002';
const survey217_1 = '21710000-0000-4000-8000-000000000003';
const survey218_3 = '21830000-0000-4000-8000-000000000004';

const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
const progress = async (id = survey216_1) => (await db.query('select * from property_progress where property_id=$1', [id])).rows[0];
const projectProg = async (id = greenValleyId) => (await db.query('select * from project_progress where project_id=$1', [id])).rows[0];
const metadata = (path = 'seed/title.pdf') => ({ original_file_name: 'Title.pdf', storage_path: path, mime_type: 'application/pdf', file_size: 1024 });

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
    create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
  `);

  for (const name of ['001_initial_schema', '002_seed_document_categories', '003_security_policies', '004_transactional_operations']) {
    await db.exec(await readFile(`database/migrations/${name}.sql`, 'utf8'));
  }

  for (const [id, role] of [[admin, 'admin'], [reviewer, 'reviewer']]) {
    await db.query('insert into auth.users(id) values($1) on conflict do nothing', [id]);
    await db.query('insert into profiles(id, full_name, role) values($1, $2, $2) on conflict (id) do update set role=$2, full_name=$2', [id, role]);
  }

  await db.exec(await readFile('database/migrations/005_project_wise_survey_hierarchy.sql', 'utf8'));
});

after(async () => {
  await db.close();
});

test('Project "Green Valley" exists and contains 4 survey numbers: 216/1, 216/2, 217/1, 218/3', async () => {
  const project = (await db.query('select * from projects where id = $1', [greenValleyId])).rows[0];
  assert.equal(project.project_name, 'Green Valley');
  assert.equal(project.project_code, 'GV001');

  const surveys = (await db.query('select * from properties where project_id = $1 order by survey_number', [greenValleyId])).rows;
  assert.equal(surveys.length, 4);
  const surveyNumbers = surveys.map(s => s.survey_number);
  assert.deepEqual(surveyNumbers, ['216/1', '216/2', '217/1', '218/3']);
});

test('Each survey number in Green Valley has exactly seven independent checklist categories', async () => {
  for (const surveyId of [survey216_1, survey216_2, survey217_1, survey218_3]) {
    const count = await scalar('select count(*) from property_documents where property_id = $1', [surveyId]);
    assert.equal(count, 7, `Survey ${surveyId} must have exactly 7 categories`);
  }

  // Total documents across Green Valley = 4 * 7 = 28
  const totalInProject = await scalar(`
    select count(d.id)
    from property_documents d
    join properties p on p.id = d.property_id
    where p.project_id = $1
  `, [greenValleyId]);
  assert.equal(totalInProject, 28);
});

test('Uploading & completing a document for 216/1 only changes 216/1 progress and project progress', async () => {
  const title216_1 = await scalar(`
    select d.id
    from property_documents d
    join document_categories c on c.id = d.document_category_id
    where d.property_id = $1 and c.display_order = 1
  `, [survey216_1]);

  // Upload file to 216/1 Title Docs
  await db.query('select commit_file($1, $2, $3)', [admin, title216_1, metadata('greenvalley/216_1/title.pdf')]);
  // Mark collected
  await db.query('select update_document($1, $2, $3, false)', [admin, title216_1, { is_collected: true }]);

  // Review & Verify
  await db.query('select update_document($1, $2, $3, true)', [reviewer, title216_1, {
    verification_status: 'Verified',
    survey_match_status: 'Matches Survey Number',
    remarks: 'Clear deed verified.'
  }]);

  // Check 216/1: 1 collected (14.29%), 1 verified (14.29%)
  const p216_1 = await progress(survey216_1);
  assert.equal(p216_1.collected, 1);
  assert.equal(p216_1.verified, 1);
  assert.equal(Number(p216_1.collection_percentage), 14.29);
  assert.equal(Number(p216_1.verification_percentage), 14.29);

  // CRITICAL BUSINESS REQUIREMENT: Survey 216/2 MUST REMAIN 0%
  const p216_2 = await progress(survey216_2);
  assert.equal(p216_2.collected, 0);
  assert.equal(p216_2.verified, 0);
  assert.equal(Number(p216_2.collection_percentage), 0);
  assert.equal(Number(p216_2.verification_percentage), 0);

  // Survey 217/1 and 218/3 MUST ALSO REMAIN 0%
  const p217_1 = await progress(survey217_1);
  assert.equal(p217_1.collected, 0);
  const p218_3 = await progress(survey218_3);
  assert.equal(p218_3.collected, 0);

  // Authoritative Project Progress: 1 collected of 28 total = 1/28*100 = 3.57%
  const prj = await projectProg(greenValleyId);
  assert.equal(prj.survey_count, 4);
  assert.equal(prj.required, 28);
  assert.equal(prj.collected, 1);
  assert.equal(prj.verified, 1);
  assert.equal(prj.pending, 27);
  assert.equal(Number(prj.collection_percentage), 3.57);
  assert.equal(Number(prj.verification_percentage), 3.57);
});

test('Prevent duplicate survey number within the same project, but allow in different project', async () => {
  // Adding duplicate 216/1 to Green Valley should fail unique constraint
  await assert.rejects(
    db.query(`
      insert into properties(project_id, survey_number, subdivision_number)
      values($1, '216/1', '1')
    `, [greenValleyId]),
    /properties_project_survey_unique/
  );

  // Adding 216/1 to a DIFFERENT project should SUCCEED
  const newProjectId = await scalar(`
    select save_project($1, $2::jsonb)
  `, [admin, JSON.stringify({
    project_name: 'Silver Oaks',
    project_code: 'SO002',
    village: 'Vadavalli'
  })]);

  const newSurveyId = await scalar(`
    insert into properties(project_id, survey_number, subdivision_number)
    values($1, '216/1', '1') returning id
  `, [newProjectId]);

  assert.ok(newSurveyId);
  const count = await scalar('select count(*) from property_documents where property_id = $1', [newSurveyId]);
  assert.equal(count, 7);
});
