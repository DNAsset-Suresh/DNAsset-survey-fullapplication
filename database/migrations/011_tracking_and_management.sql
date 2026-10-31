begin;
-- Historical identities and object IDs remain even after the live record is removed.
alter table public.audit_logs alter column property_id drop not null;
alter table public.audit_logs drop constraint if exists audit_logs_property_id_fkey;
alter table public.audit_logs drop constraint if exists audit_logs_property_document_id_fkey;
alter table public.audit_logs add column project_id uuid;
alter table public.audit_logs add column actor_name text not null default '';
alter table public.audit_logs add column actor_role text not null default '';
alter table public.audit_logs add column project_name text not null default '';
alter table public.audit_logs add column survey_number text not null default '';
alter table public.audit_logs add column ip_address text;
alter table public.audit_logs add column description text not null default '';
alter table public.property_documents add column reviewed_at timestamptz;
alter table public.upload_history drop constraint if exists upload_history_project_id_fkey;
alter table public.upload_history drop constraint if exists upload_history_property_id_fkey;
alter table public.upload_history drop constraint if exists upload_history_property_document_id_fkey;
alter table public.upload_history add column project_name text not null default '';
alter table public.upload_history add column survey_number text not null default '';
alter table public.upload_history add column document_name text not null default '';
alter table public.upload_history add column reviewer_id uuid;
alter table public.upload_history add column reviewer_name text not null default '';
alter table public.upload_history add column reviewed_at timestamptz;
alter table public.upload_history add column verification_status text not null default 'Pending';
alter table public.upload_history add column review_remarks text not null default '';
alter table public.storage_cleanup add column operation_id uuid;

create table public.document_reviews (
 id uuid primary key default gen_random_uuid(), project_id uuid, property_id uuid not null,
 property_document_id uuid not null, reviewer_id uuid not null,
 reviewer_name text not null, reviewer_role text not null,
 verification_status text not null, remarks text not null default '', rejection_reason text not null default '',
 project_name text not null, survey_number text not null, document_name text not null,
 upload_ids jsonb not null, reviewed_at timestamptz not null default now(), ip_address text
);
create index reviews_document_time on public.document_reviews(property_document_id,reviewed_at desc);
create index audit_project_time on public.audit_logs(project_id,created_at desc,id);
create index history_review_status on public.upload_history(verification_status,upload_timestamp desc);
alter table public.document_reviews enable row level security;
grant select on public.document_reviews to authenticated;
grant all on public.document_reviews to service_role;
create policy reviews_read on public.document_reviews for select to authenticated using (
 public.is_admin() or ((select role from public.profiles where id=auth.uid())='reviewer' and public.can_access_property(property_id))
 or exists(select 1 from public.upload_history h where h.property_document_id=document_reviews.property_document_id and h.user_id=auth.uid() and public.can_access_property(h.property_id))
);
-- Existing review times come from recorded review events, never from migration time.
update public.property_documents d set reviewed_at=(select max(a.created_at) from public.audit_logs a where a.property_document_id=d.id and a.action='document.reviewed') where d.reviewer_id is not null;
update public.upload_history h set project_name=coalesce(pr.project_name,''),
 survey_number=p.survey_number||case when p.subdivision_number<>'' and right(p.survey_number,length(p.subdivision_number)+1)<>'/'||p.subdivision_number then '/'||p.subdivision_number else '' end,
 document_name=c.name, reviewer_id=d.reviewer_id,reviewer_name=coalesce(r.full_name,''),reviewed_at=d.reviewed_at,
 verification_status=case when d.verification_status in ('Verified','Rejected') then d.verification_status else 'Pending' end,review_remarks=d.remarks
from public.property_documents d join public.properties p on p.id=d.property_id left join public.projects pr on pr.id=p.project_id
join public.document_categories c on c.id=d.document_category_id left join public.profiles r on r.id=d.reviewer_id where d.id=h.property_document_id;
update public.audit_logs a set actor_name=r.full_name,actor_role=r.role,description=a.action from public.profiles r where r.id=a.actor_id;
update public.audit_logs a set project_id=p.project_id,project_name=coalesce(pr.project_name,''),survey_number=p.survey_number||case when p.subdivision_number<>'' and right(p.survey_number,length(p.subdivision_number)+1)<>'/'||p.subdivision_number then '/'||p.subdivision_number else '' end
from public.properties p left join public.projects pr on pr.id=p.project_id where p.id=a.property_id;

create function private.enrich_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select full_name,role into new.actor_name,new.actor_role from public.profiles where id=new.actor_id;
 if new.property_id is not null then
  select p.project_id,coalesce(pr.project_name,''),p.survey_number||case when p.subdivision_number<>'' and right(p.survey_number,length(p.subdivision_number)+1)<>'/'||p.subdivision_number then '/'||p.subdivision_number else '' end into new.project_id,new.project_name,new.survey_number
  from public.properties p left join public.projects pr on pr.id=p.project_id where p.id=new.property_id;
 elsif new.project_id is not null then select project_name into new.project_name from public.projects where id=new.project_id;
 end if;
 new.project_name=coalesce(new.project_name,'');new.survey_number=coalesce(new.survey_number,'');
 new.ip_address=nullif(current_setting('dnassets.ip',true),'');
 if new.description='' then new.description=replace(new.action,'.',' ');end if;
 new.previous_values=new.previous_values-'access_password';new.new_values=new.new_values-'access_password';
 return new;
end $$;
create trigger enrich_audit before insert on public.audit_logs for each row execute function private.enrich_audit();
create function private.reject_audit_change() returns trigger language plpgsql as $$ begin raise exception 'Audit logs are append-only' using errcode='42501';end $$;
create trigger immutable_audit before update or delete on public.audit_logs for each row execute function private.reject_audit_change();
revoke update,delete,truncate on public.audit_logs from authenticated,anon,service_role;

create or replace function private.record_upload_history() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.upload_history(upload_id,original_upload_id,user_id,user_name,user_email,original_file_name,storage_path,file_size,mime_type,upload_timestamp,associated_survey_numbers,project_id,property_id,property_document_id,project_name,survey_number,document_name)
 select new.id,new.id,new.uploaded_by,coalesce(pr.full_name,''),coalesce(u.email,''),new.original_file_name,new.storage_path,new.file_size,new.mime_type,new.uploaded_at,p.survey_number,p.project_id,p.id,d.id,coalesce(pj.project_name,''),p.survey_number||case when p.subdivision_number<>'' and right(p.survey_number,length(p.subdivision_number)+1)<>'/'||p.subdivision_number then '/'||p.subdivision_number else '' end,c.name
 from public.property_documents d join public.properties p on p.id=d.property_id join public.document_categories c on c.id=d.document_category_id left join public.projects pj on pj.id=p.project_id left join public.profiles pr on pr.id=new.uploaded_by left join auth.users u on u.id=new.uploaded_by where d.id=new.property_document_id;
 return new;
end $$;
create function private.invalidate_review_time() returns trigger language plpgsql as $$ begin if new.reviewer_id is null then new.reviewed_at=null;end if;return new;end $$;
create trigger invalidate_review_time before update on public.property_documents for each row execute function private.invalidate_review_time();

create or replace function public.update_document(p_actor uuid,p_document uuid,p_data jsonb,p_review boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare d public.property_documents; target text; review_time timestamptz=now();
begin
 select * into strict d from public.property_documents where id=p_document for update;
 perform private.require_access(p_actor,d.property_id,case when p_review then array['admin','reviewer'] else array['admin','collector','reviewer','user'] end);
 if p_review then
  target=p_data->>'verification_status';
  if not exists(select 1 from public.uploaded_files where property_document_id=d.id) or target not in ('Pending','Under Review','Verified','Rejected') then raise exception 'Upload a file before review' using errcode='22023';end if;
  if target='Rejected' and length(trim(coalesce(p_data->>'rejection_reason','')))=0 then raise exception 'Rejection reason required' using errcode='22023';end if;
  if target='Verified' and p_data->>'survey_match_status' is distinct from 'Matches Survey Number' then raise exception 'Confirm survey match' using errcode='22023';end if;
  update public.property_documents set verification_status=target,survey_match_status=p_data->>'survey_match_status',reviewer_id=p_actor,reviewed_at=review_time,remarks=coalesce(p_data->>'remarks',''),rejection_reason=case when target='Rejected' then p_data->>'rejection_reason' else '' end where id=d.id;
  insert into public.document_reviews(project_id,property_id,property_document_id,reviewer_id,reviewer_name,reviewer_role,verification_status,remarks,rejection_reason,project_name,survey_number,document_name,upload_ids,reviewed_at,ip_address)
  select p.project_id,p.id,d.id,p_actor,r.full_name,r.role,target,coalesce(p_data->>'remarks',''),coalesce(p_data->>'rejection_reason',''),coalesce(pr.project_name,''),p.survey_number||case when p.subdivision_number<>'' and right(p.survey_number,length(p.subdivision_number)+1)<>'/'||p.subdivision_number then '/'||p.subdivision_number else '' end,c.name,
  (select jsonb_agg(f.id) from public.uploaded_files f where f.property_document_id=d.id),review_time,nullif(current_setting('dnassets.ip',true),'')
  from public.properties p left join public.projects pr on pr.id=p.project_id join public.document_categories c on c.id=d.document_category_id join public.profiles r on r.id=p_actor where p.id=d.property_id;
  update public.upload_history set reviewer_id=p_actor,reviewer_name=(select full_name from public.profiles where id=p_actor),reviewed_at=review_time,verification_status=case when target in ('Verified','Rejected') then target else 'Pending' end,review_remarks=coalesce(p_data->>'remarks','') where property_document_id=d.id and upload_id is not null;
 else
  if coalesce((p_data->>'is_collected')::boolean,false) and not exists(select 1 from public.uploaded_files where property_document_id=d.id) then raise exception 'Upload a file before collection' using errcode='22023';end if;
  update public.property_documents set is_collected=(p_data->>'is_collected')::boolean where id=d.id;
 end if;
 perform private.audit(p_actor,d.property_id,d.id,case when not p_review then 'document.collection_changed' when target='Verified' then 'document.verified' when target='Rejected' then 'document.rejected' else 'document.reviewed' end,to_jsonb(d),p_data);
end $$;

-- Single service-role entry point adds request context to existing transactional operations.
create function public.survey_run(p_actor uuid,p_operation text,p_args jsonb,p_ip text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result uuid; old_row jsonb;
begin
 perform set_config('dnassets.ip',coalesce(p_ip,''),true);
 case p_operation
 when 'save_project' then
  select to_jsonb(p)-'access_password' into old_row from public.projects p where id=(p_args->>'p_id')::uuid;
  result=public.save_project(p_actor,p_args->'p_data',(p_args->>'p_id')::uuid);
  insert into public.audit_logs(actor_id,project_id,action,previous_values,new_values) values(p_actor,result,case when old_row is null then 'project.created' else 'project.updated' end,old_row,(p_args->'p_data')-'access_password');
 when 'save_property' then result=public.save_property(p_actor,p_args->'p_data',(p_args->>'p_id')::uuid);
 when 'update_document' then perform public.update_document(p_actor,(p_args->>'p_document')::uuid,p_args->'p_data',coalesce((p_args->>'p_review')::boolean,false));
 when 'commit_file' then result=public.commit_file(p_actor,(p_args->>'p_document')::uuid,p_args->'p_file',(p_args->>'p_replace')::uuid);
 when 'remove_file' then perform public.remove_file(p_actor,(p_args->>'p_file')::uuid);
 when 'manage_member' then perform public.manage_member(p_actor,(p_args->>'p_property')::uuid,(p_args->>'p_user')::uuid,coalesce((p_args->>'p_remove')::boolean,false));
 else raise exception 'Unknown operation' using errcode='22023';end case;
 return to_jsonb(result);
end $$;

create function public.survey_history(p_actor uuid,p_filters jsonb) returns jsonb language sql stable security definer set search_path='' as $$
 with allowed as (
 select h.* from public.upload_history h where
 (private.actor_role(p_actor)='admin' or (private.can_access(p_actor,h.property_id) and (h.user_id=p_actor or private.actor_role(p_actor)='reviewer')))
 and (private.actor_role(p_actor)='admin' or h.project_id is null or h.project_id::text in(select jsonb_array_elements_text(coalesce(p_filters->'allowed_projects','[]'))))
 and (coalesce(p_filters->>'project_id','')='' or h.project_id=(p_filters->>'project_id')::uuid)
 and h.project_name ilike '%'||coalesce(p_filters->>'project','')||'%'
 and h.survey_number ilike '%'||coalesce(p_filters->>'survey','')||'%'
 and h.user_name ilike '%'||coalesce(p_filters->>'uploader','')||'%'
 and h.reviewer_name ilike '%'||coalesce(p_filters->>'reviewer','')||'%'
 and (coalesce(p_filters->>'status','')='' or h.verification_status=p_filters->>'status')
 and (nullif(p_filters->>'from','') is null or h.upload_timestamp>=(p_filters->>'from')::timestamptz)
 and (nullif(p_filters->>'to','') is null or h.upload_timestamp<((p_filters->>'to')::date+1)::timestamptz)
 ), page as (select * from allowed order by upload_timestamp desc,id limit least(coalesce((p_filters->>'limit')::int,25),1000) offset coalesce((p_filters->>'offset')::int,0))
 select jsonb_build_object('history',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),'total',(select count(*) from allowed));
$$;

create function public.survey_activity(p_actor uuid,p_filters jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if p_filters->>'kind'='audit' then
  if private.actor_role(p_actor)<>'admin' then raise exception 'Access denied' using errcode='42501';end if;
  select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb)) into result from (
   select id,actor_id,actor_name,actor_role,action,project_id,project_name,property_id,survey_number,property_document_id,ip_address,description,created_at from public.audit_logs
   where action ilike '%'||coalesce(p_filters->>'action','')||'%' and (project_name||' '||survey_number||' '||actor_name) ilike '%'||coalesce(p_filters->>'search','')||'%'
   order by created_at desc,id limit least(coalesce((p_filters->>'limit')::int,50),100) offset coalesce((p_filters->>'offset')::int,0)
  ) a;
 else
  select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb)) into result from (
   select * from public.document_reviews r where
   (private.actor_role(p_actor)='admin' or (private.can_access(p_actor,r.property_id) and (private.actor_role(p_actor)='reviewer' or exists(select 1 from public.upload_history h where h.property_document_id=r.property_document_id and h.user_id=p_actor))))
   and (private.actor_role(p_actor)='admin' or r.project_id is null or r.project_id::text in(select jsonb_array_elements_text(coalesce(p_filters->'allowed_projects','[]'))))
   and (coalesce(p_filters->>'document_id','')='' or r.property_document_id=(p_filters->>'document_id')::uuid)
   order by reviewed_at desc,id limit least(coalesce((p_filters->>'limit')::int,50),100) offset coalesce((p_filters->>'offset')::int,0)
  ) r;
 end if;return result;
end $$;

-- Audit stays outside deletion and reset. No schema or account operation occurs here.
create function public.survey_delete_preview(p_actor uuid,p_scope text,p_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare prids uuid[]; pids uuid[]; dids uuid[]; result jsonb;
begin
 if not coalesce(private.actor_role(p_actor)='admin',false) then raise exception 'Access denied' using errcode='42501';end if;
 if p_scope not in ('project','survey','all','reset') then raise exception 'Invalid scope' using errcode='22023';end if;
 if p_scope='project' and not exists(select 1 from public.projects where id=p_id) or p_scope='survey' and not exists(select 1 from public.properties where id=p_id) then raise exception 'Record missing' using errcode='P0002';end if;
 select coalesce(array_agg(id),'{}') into prids from public.projects where p_scope in ('all','reset') or (p_scope='project' and id=p_id);
 select coalesce(array_agg(id),'{}') into pids from public.properties where p_scope in ('all','reset') or project_id=any(prids) or (p_scope='survey' and id=p_id);
 select coalesce(array_agg(id),'{}') into dids from public.property_documents where property_id=any(pids);
 select jsonb_build_object('scope',p_scope,'target_id',p_id,'projects',cardinality(prids),'surveys',cardinality(pids),'checklists',cardinality(dids),
 'uploads',(select count(*) from public.uploaded_files where property_document_id=any(dids)),
 'verifications',(select count(*) from public.document_reviews where p_scope='reset' or property_id=any(pids)),
 'history',(select count(*) from public.upload_history where p_scope='reset' or property_id=any(pids)),
 'analyses',(select count(*) from public.document_analyses where p_scope='reset' or property_id=any(pids)),
 'extracted',(select count(*) from public.extracted_survey_numbers where p_scope='reset' or upload_id in(select id from public.uploaded_files where property_document_id=any(dids))),
 'memberships',(select count(*) from public.property_members where property_id=any(pids))+(select count(*) from public.project_members where project_id=any(prids)),
 'project_ids',to_jsonb(prids),'property_ids',to_jsonb(pids),
 'files',coalesce((select jsonb_agg(to_jsonb(f)) from (select storage_path,max(file_size) as file_size from (
  select storage_path,file_size from public.uploaded_files where property_document_id=any(dids)
  union all select storage_path,file_size from public.upload_history where p_scope='reset' or property_id=any(pids)
  union all select storage_path,0 from public.storage_cleanup where p_scope='reset'
 ) paths group by storage_path) f),'[]'::jsonb),
 'fingerprint',md5(coalesce((select string_agg(id::text||updated_at::text,',' order by id) from public.projects),'')||coalesce((select string_agg(id::text||updated_at::text,',' order by id) from public.properties),'')||coalesce((select string_agg(id::text||updated_at::text,',' order by id) from public.property_documents),'')||coalesce((select string_agg(id::text||updated_at::text,',' order by id) from public.upload_history),'')||coalesce((select string_agg(storage_path,',' order by storage_path) from public.storage_cleanup),''))) into result;
 return result||jsonb_build_object('storage_bytes',(select coalesce(sum((f->>'file_size')::bigint),0) from jsonb_array_elements(result->'files') f));
end $$;

create function public.survey_destroy(p_actor uuid,p_scope text,p_id uuid,p_fingerprint text,p_phrase text,p_confirmed boolean,p_operation uuid,p_ip text) returns jsonb language plpgsql security definer set search_path='' as $$
declare plan jsonb; pids uuid[]; prids uuid[]; item jsonb;
begin
 if not coalesce(private.actor_role(p_actor)='admin',false) then raise exception 'Access denied' using errcode='42501';end if;
 if not coalesce(p_confirmed,false) or p_phrase is distinct from (case when p_scope='reset' then 'RESET SURVEY DATABASE' else 'DELETE ALL PROJECTS' end) then raise exception 'Both confirmations required' using errcode='22023';end if;
 lock table public.projects,public.properties,public.property_documents,public.uploaded_files,public.upload_history,public.document_reviews,public.storage_cleanup in share row exclusive mode;
 plan=public.survey_delete_preview(p_actor,p_scope,p_id);
 if p_fingerprint is distinct from plan->>'fingerprint' then raise exception 'Data changed. Preview again.' using errcode='40001';end if;
 perform set_config('dnassets.ip',coalesce(p_ip,''),true);
 select coalesce(array_agg(value::uuid),'{}') into pids from jsonb_array_elements_text(plan->'property_ids');
 select coalesce(array_agg(value::uuid),'{}') into prids from jsonb_array_elements_text(plan->'project_ids');
 insert into public.audit_logs(actor_id,project_id,action,description,new_values)
 values(p_actor,case when p_scope='project' then p_id end,case when p_scope='reset' then 'database.reset' else 'deletion.confirmed' end,'Confirmed '||p_scope||' deletion; accounts and audit preserved',plan-'files'||jsonb_build_object('operation_id',p_operation));
 insert into public.audit_logs(actor_id,project_id,action,description) select p_actor,id,'project.deleted','Project deleted: '||project_name from public.projects where id=any(prids);
 insert into public.audit_logs(actor_id,property_id,action,description) select p_actor,id,'property.deleted','Survey deleted: '||survey_number from public.properties where id=any(pids);
 insert into public.audit_logs(actor_id,property_id,property_document_id,action,description,previous_values)
 select p_actor,d.property_id,d.id,'file.deleted','Document removed by confirmed '||p_scope||' deletion',to_jsonb(f) from public.uploaded_files f join public.property_documents d on d.id=f.property_document_id where d.property_id=any(pids);
 for item in select value from jsonb_array_elements(plan->'files') loop
  insert into public.storage_cleanup(storage_path,operation_id) values(item->>'storage_path',p_operation) on conflict(storage_path) do update set operation_id=p_operation;
 end loop;
 delete from public.properties where id=any(pids);
 delete from public.projects where id=any(prids);
 if p_scope='reset' then
  delete from public.extracted_survey_numbers;delete from public.document_analyses;
  delete from public.document_reviews;delete from public.upload_history;
 end if;
 return plan-'files'||jsonb_build_object('operation_id',p_operation);
end $$;

create function public.survey_archive(p_actor uuid,p_id uuid,p_archived boolean,p_ip text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(private.actor_role(p_actor)='admin',false) then raise exception 'Access denied' using errcode='42501';end if;
 perform set_config('dnassets.ip',coalesce(p_ip,''),true);
 update public.projects set archived_at=case when p_archived then now() end where id=p_id;
 if not found then raise exception 'Project missing' using errcode='P0002';end if;
 insert into public.audit_logs(actor_id,project_id,action,description) values(p_actor,p_id,case when p_archived then 'project.archived' else 'project.restored' end,case when p_archived then 'Project archived' else 'Project restored' end);
end $$;

create function public.survey_backup(p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb='{}'; name text; rows jsonb;
begin
 if not coalesce(private.actor_role(p_actor)='admin',false) then raise exception 'Access denied' using errcode='42501';end if;
 foreach name in array array['projects','properties','property_documents','uploaded_files','upload_history','document_reviews','document_analyses','extracted_survey_numbers','property_members','project_members','audit_logs','storage_cleanup','document_categories'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t',name) into rows;
  result=result||jsonb_build_object(name,rows);
 end loop;return result;
end $$;

revoke all on function public.survey_run(uuid,text,jsonb,text),public.survey_history(uuid,jsonb),public.survey_activity(uuid,jsonb),public.survey_delete_preview(uuid,text,uuid),public.survey_destroy(uuid,text,uuid,text,text,boolean,uuid,text),public.survey_archive(uuid,uuid,boolean,text),public.survey_backup(uuid) from public,anon,authenticated;
grant execute on function public.survey_run(uuid,text,jsonb,text),public.survey_history(uuid,jsonb),public.survey_activity(uuid,jsonb),public.survey_delete_preview(uuid,text,uuid),public.survey_destroy(uuid,text,uuid,text,text,boolean,uuid,text),public.survey_archive(uuid,uuid,boolean,text),public.survey_backup(uuid) to service_role;
revoke all on all functions in schema private from public,anon,authenticated;
commit;
