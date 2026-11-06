begin;

-- 1. Project Schedules Table
create table if not exists public.project_schedules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  village text not null default '',
  survey_number text not null check (length(trim(survey_number)) >= 1),
  subdivision_number text not null default '',
  total_extent text not null default '',
  total_extent_sqft numeric(16,2) default null,
  extent_conveyed text not null default '',
  extent_conveyed_sqft numeric(16,2) default null,
  patta_number text not null default '',
  root_parent_deed text not null default '',
  previous_doc_pr text not null default '',
  schedule_value numeric(16,2) default null,
  verification_status text not null default 'Verified',
  source_page text not null default '',
  remarks text not null default '',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_schedules_project_idx on public.project_schedules(project_id);
create index if not exists project_schedules_survey_idx on public.project_schedules(project_id, lower(trim(survey_number)));

-- 2. Previous Document (PR) Chains Table
create table if not exists public.project_pr_chains (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  schedule_id uuid references public.project_schedules(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  survey_number text not null default '',
  village text not null default '',
  parent_root_doc text not null default '',
  previous_doc_number text not null default '',
  registration_year text not null default '',
  registration_date date default null,
  document_type text not null default 'Sale Deed',
  ec_reference text not null default '',
  subdivisions text not null default '',
  acquisition_deed text not null default '',
  from_party text not null default '',
  to_party text not null default '',
  extent text not null default '',
  value numeric(16,2) default null,
  verification_status text not null default 'Verified',
  notes text not null default '',
  attachment_url text not null default '',
  attachment_name text not null default '',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_pr_chains_project_idx on public.project_pr_chains(project_id);
create index if not exists project_pr_chains_survey_idx on public.project_pr_chains(project_id, lower(trim(survey_number)));

-- 3. Acquisition Deeds Table
create table if not exists public.project_acquisition_deeds (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  document_number text not null default '',
  document_type text not null default 'Sale Deed',
  registration_year text not null default '',
  registration_date date default null,
  sro text not null default '',
  seller text not null default '',
  purchaser text not null default '',
  previous_document text not null default '',
  survey_numbers text not null default '',
  extent text not null default '',
  extent_sqft numeric(16,2) default null,
  value numeric(16,2) default null,
  source text not null default '',
  status text not null default 'Verified',
  remarks text not null default '',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_acquisition_deeds_project_idx on public.project_acquisition_deeds(project_id);

-- 4. Row Level Security & Grants
alter table public.project_schedules enable row level security;
alter table public.project_pr_chains enable row level security;
alter table public.project_acquisition_deeds enable row level security;

grant all on public.project_schedules to authenticated, service_role;
grant all on public.project_pr_chains to authenticated, service_role;
grant all on public.project_acquisition_deeds to authenticated, service_role;

drop policy if exists project_schedules_policy on public.project_schedules;
create policy project_schedules_policy on public.project_schedules for all to authenticated using(public.can_access_project(project_id));

drop policy if exists project_pr_chains_policy on public.project_pr_chains;
create policy project_pr_chains_policy on public.project_pr_chains for all to authenticated using(public.can_access_project(project_id));

drop policy if exists project_acquisition_deeds_policy on public.project_acquisition_deeds;
create policy project_acquisition_deeds_policy on public.project_acquisition_deeds for all to authenticated using(public.can_access_project(project_id));

commit;
