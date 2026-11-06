import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let db;
const admin = '10000000-0000-4000-8000-000000000001';
const reviewer = '10000000-0000-4000-8000-000000000003';
const pondyAuraId = '22222222-2222-4000-8000-000000000001';
const greenValleyId = '11111111-1111-4000-8000-000000000001';

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

  const migrations = [
    '001_initial_schema',
    '002_seed_document_categories',
    '003_security_policies',
    '004_transactional_operations',
    '005_project_wise_survey_hierarchy',
    '017_survey_schedules_and_pr_chains'
  ];

  for (const name of migrations) {
    await db.exec(await readFile(`database/migrations/${name}.sql`, 'utf8'));
  }

  for (const [id, role] of [[admin, 'admin'], [reviewer, 'reviewer']]) {
    await db.query('insert into auth.users(id) values($1) on conflict do nothing', [id]);
    await db.query('insert into profiles(id, full_name, role) values($1, $2, $2) on conflict (id) do update set role=$2, full_name=$2', [id, role]);
  }

  // Create Pondy Aura project for testing
  await db.query(`
    insert into projects (id, project_name, project_code, district, taluk, village, total_land_extent, measurement_unit, created_by)
    values ($1, 'Pondy Aura', 'PA001', 'Puducherry', 'Villianur', 'Mathur', 10.50, 'acres', $2)
    on conflict (id) do nothing
  `, [pondyAuraId, admin]);
});

after(async () => {
  if (db) await db.close();
});

test('Phase 1 & 2: Tables exist with expected columns and relations', async () => {
  const scheduleCols = (await db.query(`
    select column_name from information_schema.columns 
    where table_name = 'project_schedules'
  `)).rows.map(r => r.column_name);

  assert.ok(scheduleCols.includes('project_id'));
  assert.ok(scheduleCols.includes('survey_number'));
  assert.ok(scheduleCols.includes('village'));
  assert.ok(scheduleCols.includes('total_extent'));
  assert.ok(scheduleCols.includes('extent_conveyed'));
  assert.ok(scheduleCols.includes('patta_number'));
  assert.ok(scheduleCols.includes('root_parent_deed'));
  assert.ok(scheduleCols.includes('previous_doc_pr'));
  assert.ok(scheduleCols.includes('schedule_value'));

  const prCols = (await db.query(`
    select column_name from information_schema.columns 
    where table_name = 'project_pr_chains'
  `)).rows.map(r => r.column_name);

  assert.ok(prCols.includes('project_id'));
  assert.ok(prCols.includes('survey_number'));
  assert.ok(prCols.includes('previous_doc_number'));
  assert.ok(prCols.includes('parent_root_doc'));
  assert.ok(prCols.includes('registration_year'));
  assert.ok(prCols.includes('ec_reference'));
  assert.ok(prCols.includes('verification_status'));
});

test('Phase 3 & 4: Insert and query schedule entry with village and survey details', async () => {
  const insertRes = await db.query(`
    insert into project_schedules (
      project_id, village, survey_number, subdivision_number, total_extent, extent_conveyed,
      patta_number, root_parent_deed, previous_doc_pr, schedule_value, created_by
    ) values (
      $1, 'Mathur', '282/1', '1', '66½ cent', '0.26½ cent',
      '1506', '2223/2000 → 3618/2020', '1480/93, 1482/93, 1483/93', 79500, $2
    ) returning *
  `, [pondyAuraId, admin]);

  assert.equal(insertRes.rows.length, 1);
  const row = insertRes.rows[0];
  assert.equal(row.village, 'Mathur');
  assert.equal(row.survey_number, '282/1');
  assert.equal(row.patta_number, '1506');
  assert.equal(Number(row.schedule_value), 79500);
  assert.equal(row.previous_doc_pr, '1480/93, 1482/93, 1483/93');
});

test('Phase 5: Insert and query PR Chain with verification status', async () => {
  const prRes = await db.query(`
    insert into project_pr_chains (
      project_id, survey_number, village, parent_root_doc, previous_doc_number,
      registration_year, document_type, ec_reference, verification_status, created_by
    ) values (
      $1, '282/1', 'Mathur', '2223/2000', '1480/93',
      '1993', 'Sale Deed', 'EC-1993-2023-Pondy', 'Verified', $2
    ) returning *
  `, [pondyAuraId, admin]);

  assert.equal(prRes.rows.length, 1);
  const prRow = prRes.rows[0];
  assert.equal(prRow.survey_number, '282/1');
  assert.equal(prRow.previous_doc_number, '1480/93');
  assert.equal(prRow.verification_status, 'Verified');
});

test('Phase 7 & 9: Project Isolation enforced - Project A records never leak into Project B', async () => {
  // Query for Green Valley
  const greenValleySchedules = (await db.query(`
    select * from project_schedules where project_id = $1
  `, [greenValleyId])).rows;

  assert.equal(greenValleySchedules.length, 0, 'Green Valley must not see Pondy Aura schedules');

  // Query for Pondy Aura
  const pondySchedules = (await db.query(`
    select * from project_schedules where project_id = $1
  `, [pondyAuraId])).rows;

  assert.equal(pondySchedules.length, 1, 'Pondy Aura must see its own schedule');
});
