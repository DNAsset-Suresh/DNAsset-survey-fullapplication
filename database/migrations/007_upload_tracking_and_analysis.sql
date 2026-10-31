begin;

-- 1. Allow 'user' role in profiles check constraint
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'reviewer', 'collector', 'viewer', 'user'));

-- 2. Update uploaded_files mime_type check constraint
alter table public.uploaded_files drop constraint if exists uploaded_files_mime_type_check;
alter table public.uploaded_files add constraint uploaded_files_mime_type_check
  check (mime_type in (
    'application/pdf',
    'image/jpeg',
    'image/png',
    'text/csv',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ));

-- 3. Update storage.buckets land-documents allowed MIME types
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'text/csv',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel'
]
where id = 'land-documents';

-- 4. Upload History Table (Task 1)
create table if not exists public.upload_history (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid references public.uploaded_files(id) on delete cascade,
  user_id uuid references public.profiles(id),
  user_name text not null default '',
  user_email text not null default '',
  original_file_name text not null,
  storage_path text not null,
  file_size bigint not null default 0,
  mime_type text not null default '',
  upload_timestamp timestamptz not null default now(),
  associated_survey_numbers text not null default '',
  processing_status text not null default 'Uploaded'
    check (processing_status in ('Uploaded', 'Processing', 'Completed', 'Failed')),
  email_notification_status text not null default 'pending'
    check (email_notification_status in ('pending', 'sent', 'failed', 'skipped')),
  email_notification_error text,
  email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists upload_history_upload_id_idx on public.upload_history(upload_id);
create index if not exists upload_history_user_idx on public.upload_history(user_id);
create index if not exists upload_history_timestamp_idx on public.upload_history(upload_timestamp desc);

-- 5. Document Analyses Table (Task 2)
create table if not exists public.document_analyses (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references public.uploaded_files(id) on delete cascade,
  property_document_id uuid references public.property_documents(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  uploaded_by uuid references public.profiles(id),
  original_file_name text not null,
  status text not null default 'Uploaded'
    check (status in ('Uploaded', 'Processing', 'Completed', 'Failed')),
  error_message text,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(upload_id)
);

create index if not exists document_analyses_property_idx on public.document_analyses(property_id);
create index if not exists document_analyses_uploader_idx on public.document_analyses(uploaded_by);

-- 6. Extracted Survey Numbers Table (Task 2)
create table if not exists public.extracted_survey_numbers (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.document_analyses(id) on delete cascade,
  upload_id uuid not null references public.uploaded_files(id) on delete cascade,
  s_no integer not null default 1,
  survey_number text not null,
  subdivision text not null default 'Not Found',
  village text not null default 'Not Found',
  taluk text not null default 'Not Found',
  district text not null default 'Not Found',
  plot_number text not null default 'Not Found',
  extent text not null default 'Not Found',
  patta_number text not null default 'Not Found',
  source_reference text not null default '',
  source_file_name text not null,
  raw_extracted_text text default '',
  requires_manual_review boolean not null default false,
  review_reason text default '',
  created_at timestamptz not null default now()
);

create index if not exists extracted_surveys_analysis_idx on public.extracted_survey_numbers(analysis_id);
create index if not exists extracted_surveys_number_idx on public.extracted_survey_numbers(lower(trim(survey_number)));

-- 7. Update commit_file function to permit 'user' role
create or replace function public.commit_file(p_actor uuid, p_document uuid, p_file jsonb, p_replace uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare d public.property_documents; previous public.uploaded_files; result uuid;
begin
 select * into strict d from public.property_documents where id=p_document for update;
 perform private.require_access(p_actor, d.property_id, array['admin', 'collector', 'reviewer', 'user']);
 if p_replace is not null then
  perform private.require_access(p_actor, d.property_id, array['admin', 'collector', 'user']);
  select * into strict previous from public.uploaded_files where id=p_replace and property_document_id=d.id;
  if private.actor_role(p_actor) <> 'admin' and previous.uploaded_by <> p_actor then
    raise exception 'You cannot replace another user''s file' using errcode='42501';
  end if;
 end if;
 insert into public.uploaded_files(property_document_id, original_file_name, storage_path, mime_type, file_size, uploaded_by, replaced_at)
 values(d.id, p_file->>'original_file_name', p_file->>'storage_path', p_file->>'mime_type', (p_file->>'file_size')::bigint, p_actor, case when p_replace is not null then now() end) returning id into result;
 if p_replace is not null then
  insert into public.storage_cleanup(storage_path) values(previous.storage_path) on conflict do nothing;
  delete from public.uploaded_files where id=p_replace;
 end if;
 update public.property_documents set verification_status='Uploaded', reviewer_id=null, survey_match_status='Not Checked', rejection_reason='' where id=d.id;
 perform private.audit(p_actor, d.property_id, d.id, case when p_replace is null then 'file.uploaded' else 'file.replaced' end, case when p_replace is not null then to_jsonb(previous) end, p_file||jsonb_build_object('id', result));
 return result;
end $$;

-- 8. Update remove_file function to protect against unauthorized deletions
create or replace function public.remove_file(p_actor uuid, p_file uuid) returns void language plpgsql security definer set search_path='' as $$
declare f public.uploaded_files; d public.property_documents;
begin
 select * into strict f from public.uploaded_files where id=p_file;
 select * into strict d from public.property_documents where id=f.property_document_id for update;
 perform private.require_access(p_actor, d.property_id, array['admin', 'collector', 'user']);
 if private.actor_role(p_actor) <> 'admin' and f.uploaded_by <> p_actor then
   raise exception 'You cannot delete another user''s document' using errcode='42501';
 end if;
 delete from public.uploaded_files where id=f.id;
 if not found then raise exception 'File no longer exists' using errcode='P0002'; end if;
 insert into public.storage_cleanup(storage_path) values(f.storage_path) on conflict do nothing;
 update public.property_documents set is_collected=case when exists(select 1 from public.uploaded_files where property_document_id=d.id) then is_collected else false end,
 verification_status=case when exists(select 1 from public.uploaded_files where property_document_id=d.id) then 'Uploaded' else 'Pending' end,
 reviewer_id=null, survey_match_status='Not Checked', rejection_reason='' where id=d.id;
 perform private.audit(p_actor, d.property_id, d.id, 'file.deleted', to_jsonb(f), null);
end $$;

-- 9. Row Level Security Policies
alter table public.upload_history enable row level security;
alter table public.document_analyses enable row level security;
alter table public.extracted_survey_numbers enable row level security;

grant select on public.upload_history, public.document_analyses, public.extracted_survey_numbers to authenticated;
grant all on public.upload_history, public.document_analyses, public.extracted_survey_numbers to service_role;

drop policy if exists upload_history_read on public.upload_history;
create policy upload_history_read on public.upload_history for select to authenticated using (
  public.is_admin() or user_id = auth.uid()
);

drop policy if exists document_analyses_read on public.document_analyses;
create policy document_analyses_read on public.document_analyses for select to authenticated using (
  public.is_admin() or (property_id is not null and public.can_access_property(property_id))
);

drop policy if exists extracted_surveys_read on public.extracted_survey_numbers;
create policy extracted_surveys_read on public.extracted_survey_numbers for select to authenticated using (
  exists (
    select 1 from public.document_analyses a
    where a.id = analysis_id and (public.is_admin() or (a.property_id is not null and public.can_access_property(a.property_id)))
  )
);

commit;
