begin;

-- 1. Projects Table
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  project_name text not null check (length(trim(project_name)) >= 1),
  project_code text not null default '',
  description text not null default '',
  promoter_name text not null default '',
  village text not null default '',
  taluk text not null default '',
  district text not null default '',
  project_address text not null default '',
  total_land_extent numeric(16,4) check (total_land_extent is null or total_land_extent >= 0),
  measurement_unit text not null default 'acres' check (measurement_unit in ('acres','cents','hectares','sq ft','sq m')),
  status text not null default 'Active' check (status in ('Active','Completed','On Hold','Under Review','Draft')),
  remarks text not null default '',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists projects_name_unique on public.projects(lower(trim(project_name)));
create index if not exists projects_code_idx on public.projects(lower(trim(project_code)));

-- 2. Extend properties (survey_numbers backing table) with project_id and attributes
alter table public.properties add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.properties add column if not exists subdivision_number text not null default '';
alter table public.properties add column if not exists patta_number text not null default '';
alter table public.properties add column if not exists status text not null default 'Active' check (status in ('Active','Verified','Pending','Rejected','In Progress'));

create index if not exists properties_project_idx on public.properties(project_id);
create unique index if not exists properties_project_survey_unique on public.properties
  (project_id, lower(trim(survey_number)), lower(trim(subdivision_number)))
  where project_id is not null;

-- 3. Project Members Table
create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key(project_id, user_id)
);
create index if not exists project_members_user on public.project_members(user_id);

-- 4. Helper security functions for projects
create or replace function private.can_access_project(actor uuid, project uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id=actor and role='admin')
  or exists(select 1 from public.project_members where user_id=actor and project_id=project)
  or exists(select 1 from public.properties p join public.property_members m on m.property_id=p.id where p.project_id=project and m.user_id=actor)
$$;

create or replace function public.can_access_project(project uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_access_project(auth.uid(), project)
$$;

revoke all on function public.can_access_project(uuid) from public, anon;
grant execute on function public.can_access_project(uuid) to authenticated;

-- 5. Row Level Security for Projects
alter table public.projects enable row level security;
alter table public.project_members enable row level security;

grant select on public.projects, public.project_members to authenticated;
grant all on public.projects, public.project_members to service_role;

drop policy if exists projects_read on public.projects;
create policy projects_read on public.projects for select to authenticated using(public.can_access_project(id));

drop policy if exists project_members_read on public.project_members;
create policy project_members_read on public.project_members for select to authenticated using(public.can_access_project(project_id));

-- Update properties read policy to also allow if user can access the parent project
drop policy if exists properties_read on public.properties;
create policy properties_read on public.properties for select to authenticated using(
  public.can_access_property(id) or (project_id is not null and public.can_access_project(project_id))
);

-- 6. Trigger for updated_at on projects
drop trigger if exists projects_timestamp on public.projects;
create trigger projects_timestamp before update on public.projects for each row execute function private.touch_updated_at();

-- 7. Views for survey_numbers and survey_documents for clean semantic querying
create or replace view public.survey_numbers with (security_invoker=true) as
select
  p.id,
  p.project_id,
  p.survey_number,
  p.subdivision_number,
  p.property_name,
  p.village,
  p.taluk,
  p.district,
  p.owner_name,
  p.land_extent,
  p.land_extent_unit,
  p.patta_number,
  p.status,
  p.remarks,
  p.created_by,
  p.created_at,
  p.updated_at
from public.properties p;

create or replace view public.survey_documents with (security_invoker=true) as
select
  d.id,
  d.property_id as survey_number_id,
  d.document_category_id,
  d.is_collected,
  d.verification_status,
  d.survey_match_status,
  d.reviewer_id,
  d.remarks,
  d.rejection_reason,
  d.created_at,
  d.updated_at
from public.property_documents d;

grant select on public.survey_numbers, public.survey_documents to authenticated, service_role;

-- 8. Project Progress View
create or replace view public.project_progress with (security_invoker=true) as
select
  pr.id as project_id,
  pr.project_name,
  pr.project_code,
  count(distinct p.id)::integer as survey_count,
  (count(distinct p.id) * 7)::integer as required,
  count(d.id) filter(where d.is_collected and exists(select 1 from public.uploaded_files f where f.property_document_id=d.id))::integer as collected,
  ((count(distinct p.id) * 7) - count(d.id) filter(where d.is_collected and exists(select 1 from public.uploaded_files f where f.property_document_id=d.id)))::integer as pending,
  count(d.id) filter(where d.verification_status='Verified' and exists(select 1 from public.uploaded_files f where f.property_document_id=d.id))::integer as verified,
  count(d.id) filter(where d.verification_status='Rejected')::integer as rejected,
  count(d.id) filter(where d.verification_status='Under Review')::integer as under_review,
  case
    when count(distinct p.id) > 0 then
      round(100.0 * count(d.id) filter(where d.is_collected and exists(select 1 from public.uploaded_files f where f.property_document_id=d.id)) / (count(distinct p.id) * 7), 2)
    else 0.00
  end as collection_percentage,
  case
    when count(distinct p.id) > 0 then
      round(100.0 * count(d.id) filter(where d.verification_status='Verified' and exists(select 1 from public.uploaded_files f where f.property_document_id=d.id)) / (count(distinct p.id) * 7), 2)
    else 0.00
  end as verification_percentage
from public.projects pr
left join public.properties p on p.project_id = pr.id
left join public.property_documents d on d.property_id = p.id
group by pr.id, pr.project_name, pr.project_code;

grant select on public.project_progress to authenticated, service_role;

-- 9. RPC Functions: save_project and save_survey_number
create or replace function public.save_project(p_actor uuid, p_data jsonb, p_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; old_row jsonb;
begin
  if p_id is null then
    if not coalesce(private.actor_role(p_actor) in ('admin','collector'), false) then
      raise exception 'Access denied' using errcode='42501';
    end if;
    insert into public.projects(
      project_name, project_code, description, promoter_name,
      village, taluk, district, project_address,
      total_land_extent, measurement_unit, status, remarks, created_by
    ) values (
      p_data->>'project_name',
      coalesce(p_data->>'project_code', ''),
      coalesce(p_data->>'description', ''),
      coalesce(p_data->>'promoter_name', ''),
      coalesce(p_data->>'village', ''),
      coalesce(p_data->>'taluk', ''),
      coalesce(p_data->>'district', ''),
      coalesce(p_data->>'project_address', ''),
      (p_data->>'total_land_extent')::numeric,
      coalesce(p_data->>'measurement_unit', 'acres'),
      coalesce(p_data->>'status', 'Active'),
      coalesce(p_data->>'remarks', ''),
      p_actor
    ) returning id into result;
    insert into public.project_members(project_id, user_id) values(result, p_actor) on conflict do nothing;
  else
    if not coalesce(private.actor_role(p_actor) in ('admin','collector'), false) then
      raise exception 'Access denied' using errcode='42501';
    end if;
    select to_jsonb(pr) into old_row from public.projects pr where id = p_id for update;
    if old_row is null then raise exception 'Project not found' using errcode='P0002'; end if;
    update public.projects set
      project_name = p_data->>'project_name',
      project_code = coalesce(p_data->>'project_code', ''),
      description = coalesce(p_data->>'description', ''),
      promoter_name = coalesce(p_data->>'promoter_name', ''),
      village = coalesce(p_data->>'village', ''),
      taluk = coalesce(p_data->>'taluk', ''),
      district = coalesce(p_data->>'district', ''),
      project_address = coalesce(p_data->>'project_address', ''),
      total_land_extent = (p_data->>'total_land_extent')::numeric,
      measurement_unit = coalesce(p_data->>'measurement_unit', 'acres'),
      status = coalesce(p_data->>'status', 'Active'),
      remarks = coalesce(p_data->>'remarks', '')
    where id = p_id;
    result = p_id;
  end if;
  return result;
end $$;

revoke all on function public.save_project(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.save_project(uuid, jsonb, uuid) to service_role;

-- 10. Seed Default Master Project: "Green Valley" (GV001) with 4 Survey Numbers
insert into public.projects (
  id, project_name, project_code, description, promoter_name,
  village, taluk, district, project_address,
  total_land_extent, measurement_unit, status, remarks
) values (
  '11111111-1111-4000-8000-000000000001',
  'Green Valley',
  'GV001',
  'Premium gated layout and farmland development project across 4 contiguous survey parcels in Perur taluk.',
  'DNAssets Real Estate Ventures',
  'Perur',
  'Perur',
  'Coimbatore',
  'Green Valley Enclave, Siruvani Main Road, Perur, Coimbatore - 641010',
  24.5000,
  'acres',
  'Active',
  'Comprehensive 7-document verification across all 4 survey numbers.'
) on conflict (id) do update set
  project_name = excluded.project_name,
  project_code = excluded.project_code,
  total_land_extent = excluded.total_land_extent;

-- Associate initial 216/1 survey record with Green Valley
update public.properties set
  project_id = '11111111-1111-4000-8000-000000000001',
  property_name = 'Green Valley',
  subdivision_number = '1',
  land_extent = 6.2500,
  land_extent_unit = 'acres',
  village = 'Perur',
  taluk = 'Perur',
  district = 'Coimbatore',
  owner_name = 'R. Subramaniam',
  status = 'Active',
  remarks = 'Main road access parcel.'
where id = '21610000-0000-4000-8000-000000000001';

-- Seed the remaining 3 survey numbers under Green Valley
insert into public.properties (
  id, project_id, survey_number, subdivision_number, property_name,
  village, taluk, district, owner_name, land_extent, land_extent_unit, status, remarks
) values
(
  '21620000-0000-4000-8000-000000000002',
  '11111111-1111-4000-8000-000000000001',
  '216/2',
  '2',
  'Green Valley',
  'Perur',
  'Perur',
  'Coimbatore',
  'S. Meenakshi',
  5.5000,
  'acres',
  'Active',
  'East portion adjoining canal.'
),
(
  '21710000-0000-4000-8000-000000000003',
  '11111111-1111-4000-8000-000000000001',
  '217/1',
  '1',
  'Green Valley',
  'Perur',
  'Perur',
  'Coimbatore',
  'K. Sundaram & Brothers',
  7.0000,
  'acres',
  'Active',
  'Northern agricultural block.'
),
(
  '21830000-0000-4000-8000-000000000004',
  '11111111-1111-4000-8000-000000000001',
  '218/3',
  '3',
  'Green Valley',
  'Perur',
  'Perur',
  'Coimbatore',
  'Green Valley Farms Ltd',
  5.7500,
  'acres',
  'Active',
  'Southern parcel with motor pump.'
)
on conflict (id) do nothing;

-- Ensure checklist records exist for all seeded survey numbers
insert into public.property_documents(property_id, document_category_id)
select p.id, c.id
from public.properties p
cross join public.document_categories c
where c.is_active
on conflict do nothing;

-- Assign project memberships for existing team users
insert into public.project_members (project_id, user_id)
select '11111111-1111-4000-8000-000000000001'::uuid, u.id
from (
  values
    ('10000000-0000-4000-8000-000000000099'::uuid),
    ('10000000-0000-4000-8000-000000000007'::uuid),
    ('10000000-0000-4000-8000-000000000005'::uuid),
    ('10000000-0000-4000-8000-000000000001'::uuid),
    ('10000000-0000-4000-8000-000000000003'::uuid)
) as u(id)
join public.profiles p on p.id = u.id
on conflict do nothing;

-- Also assign property members for the new survey numbers so reviewers/admins have direct access
insert into public.property_members (property_id, user_id)
select p.id, u.id
from public.properties p
cross join (
  values
    ('10000000-0000-4000-8000-000000000099'::uuid),
    ('10000000-0000-4000-8000-000000000007'::uuid),
    ('10000000-0000-4000-8000-000000000001'::uuid),
    ('10000000-0000-4000-8000-000000000003'::uuid)
) as u(id)
join public.profiles pr on pr.id = u.id
where p.project_id = '11111111-1111-4000-8000-000000000001'
on conflict do nothing;

commit;
