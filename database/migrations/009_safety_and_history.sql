begin;
alter table public.projects add column if not exists archived_at timestamptz;
alter table public.projects add column if not exists owner_name text not null default '';
alter table public.upload_history add column if not exists project_id uuid references public.projects(id);
alter table public.upload_history add column if not exists property_id uuid references public.properties(id);
alter table public.upload_history add column if not exists property_document_id uuid references public.property_documents(id);
alter table public.upload_history add column if not exists original_upload_id uuid;
alter table public.upload_history add column if not exists removed_at timestamptz;
alter table public.upload_history drop constraint if exists upload_history_upload_id_fkey;
alter table public.upload_history add constraint upload_history_upload_id_fkey foreign key(upload_id) references public.uploaded_files(id) on delete set null;
update public.upload_history h set project_id=p.project_id,property_id=p.id,property_document_id=d.id,original_upload_id=f.id
from public.uploaded_files f join public.property_documents d on d.id=f.property_document_id join public.properties p on p.id=d.property_id where h.upload_id=f.id;

create or replace function private.record_upload_history() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.upload_history(upload_id,original_upload_id,user_id,user_name,user_email,original_file_name,storage_path,file_size,mime_type,upload_timestamp,associated_survey_numbers,project_id,property_id,property_document_id)
 select new.id,new.id,new.uploaded_by,coalesce(pr.full_name,''),coalesce(u.email,''),new.original_file_name,new.storage_path,new.file_size,new.mime_type,new.uploaded_at,p.survey_number,p.project_id,p.id,d.id
 from public.property_documents d join public.properties p on p.id=d.property_id left join public.profiles pr on pr.id=new.uploaded_by left join auth.users u on u.id=new.uploaded_by where d.id=new.property_document_id;
 return new;
end $$;
create trigger record_upload_history after insert on public.uploaded_files for each row execute function private.record_upload_history();
create or replace function private.retain_upload_history() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.upload_history set removed_at=now() where upload_id=old.id;
 return old;
end $$;
create trigger retain_upload_history before delete on public.uploaded_files for each row execute function private.retain_upload_history();
create index if not exists history_project_timestamp on public.upload_history(project_id,upload_timestamp desc,id);
create index if not exists properties_project_id on public.properties(project_id);
create index if not exists documents_property_id on public.property_documents(property_id);
create index if not exists files_document_id on public.uploaded_files(property_document_id);
do $$ declare policy_name text; begin
 for policy_name in select policyname from pg_policies where schemaname='public' and tablename='upload_history' loop
  execute format('drop policy %I on public.upload_history',policy_name);
 end loop;
end $$;
create policy history_read on public.upload_history for select to authenticated using (
 public.is_admin() or (user_id=auth.uid() and public.can_access_property(property_id))
);
commit;
