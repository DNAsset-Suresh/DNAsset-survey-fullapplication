begin;
create schema if not exists private;
revoke all on schema private from public;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (length(full_name) <= 160),
  role text not null default 'viewer' check (role in ('admin','reviewer','collector','viewer')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  survey_number text not null check (length(trim(survey_number)) between 1 and 80),
  property_name text not null default '', village text not null default '',
  taluk text not null default '', district text not null default '',
  owner_name text not null default '', land_extent numeric(16,4) check (land_extent >= 0),
  land_extent_unit text not null default 'acres' check (land_extent_unit in ('acres','cents','hectares','sq ft','sq m')),
  remarks text not null default '', created_by uuid references profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- A survey number is scoped to a property/location, never globally unique.
create unique index properties_identity on properties
  (lower(trim(survey_number)),lower(trim(property_name)),lower(trim(village)),lower(trim(taluk)),lower(trim(district)));
create table public.property_members (
  property_id uuid not null references properties(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  primary key(property_id,user_id)
);
create index property_members_user on property_members(user_id);
create table public.document_categories (
  id uuid primary key default gen_random_uuid(), name text not null unique,
  description text not null default '', display_order integer not null unique,
  is_active boolean not null default true
);
create table public.property_documents (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  document_category_id uuid not null references document_categories(id),
  is_collected boolean not null default false,
  verification_status text not null default 'Pending'
    check (verification_status in ('Pending','Uploaded','Under Review','Verified','Rejected')),
  survey_match_status text not null default 'Not Checked'
    check (survey_match_status in ('Not Checked','Matches Survey Number','Mismatch Found','Requires Manual Review')),
  reviewer_id uuid references profiles(id), remarks text not null default '', rejection_reason text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(property_id,document_category_id),
  check (verification_status <> 'Rejected' or length(trim(rejection_reason)) > 0),
  check (verification_status <> 'Verified' or (reviewer_id is not null and survey_match_status = 'Matches Survey Number'))
);
create table public.uploaded_files (
  id uuid primary key default gen_random_uuid(),
  property_document_id uuid not null references property_documents(id) on delete cascade,
  original_file_name text not null check(length(original_file_name) between 1 and 255),
  storage_path text not null unique, mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png')),
  file_size bigint not null check(file_size > 0), uploaded_by uuid not null references profiles(id),
  uploaded_at timestamptz not null default now(), replaced_at timestamptz
);
create index uploaded_files_document on uploaded_files(property_document_id);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(), property_id uuid not null references properties(id),
  property_document_id uuid references property_documents(id), actor_id uuid not null references profiles(id),
  action text not null, previous_values jsonb, new_values jsonb, created_at timestamptz not null default now()
);
create index audit_logs_property_time on audit_logs(property_id,created_at desc);
-- Removed objects are queued transactionally; a failed storage delete never loses its retry path.
create table public.storage_cleanup (
  storage_path text primary key, created_at timestamptz not null default now()
);
create function private.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger properties_timestamp before update on properties for each row execute function private.touch_updated_at();
create trigger profiles_timestamp before update on profiles for each row execute function private.touch_updated_at();
create trigger documents_timestamp before update on property_documents for each row execute function private.touch_updated_at();
create function private.create_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,full_name) values(new.id,left(coalesce(new.raw_user_meta_data->>'full_name',''),160));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.create_profile();
insert into public.profiles(id,full_name) select id,left(coalesce(raw_user_meta_data->>'full_name',''),160) from auth.users on conflict(id) do nothing;
commit;
