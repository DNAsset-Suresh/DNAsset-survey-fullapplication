begin;
-- Correct only upgrade-added display snapshots for legacy split survey identities.
create or replace function private.record_upload_history() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.upload_history(upload_id,original_upload_id,user_id,user_name,user_email,original_file_name,storage_path,file_size,mime_type,upload_timestamp,associated_survey_numbers,project_id,property_id,property_document_id,project_name,survey_number,document_name)
 select new.id,new.id,new.uploaded_by,coalesce(pr.full_name,''),coalesce(u.email,''),new.original_file_name,new.storage_path,new.file_size,new.mime_type,new.uploaded_at,p.survey_number,p.project_id,p.id,d.id,coalesce(pj.project_name,''),p.survey_number||case when p.subdivision_number<>'' and right(p.survey_number,length(p.subdivision_number)+1)<>'/'||p.subdivision_number then '/'||p.subdivision_number else '' end,c.name
 from public.property_documents d join public.properties p on p.id=d.property_id join public.document_categories c on c.id=d.document_category_id left join public.projects pj on pj.id=p.project_id left join public.profiles pr on pr.id=new.uploaded_by left join auth.users u on u.id=new.uploaded_by where d.id=new.property_document_id;
 return new;
end $$;
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
update public.upload_history h set survey_number=p.survey_number||case when p.subdivision_number<>'' and right(p.survey_number,length(p.subdivision_number)+1)<>'/'||p.subdivision_number then '/'||p.subdivision_number else '' end from public.properties p where p.id=h.property_id;
create or replace function private.enrich_audit() returns trigger language plpgsql security definer set search_path='' as $$
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
commit;
