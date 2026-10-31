begin;
create function private.require_access(actor uuid, property uuid, allowed text[]) returns void language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(private.can_access(actor,property),false) or not coalesce(private.actor_role(actor)=any(allowed),false) then
   raise exception 'Access denied' using errcode='42501';
 end if;
end $$;
create function private.audit(actor uuid, property uuid, document uuid, verb text, old_data jsonb, new_data jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_logs(actor_id,property_id,property_document_id,action,previous_values,new_values)
 values(actor,property,document,verb,old_data,new_data);
 update public.properties set updated_at=now() where id=property;
end $$;

create function public.save_property(p_actor uuid,p_data jsonb,p_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; old_row jsonb;
begin
 if p_id is null then
  if not coalesce(private.actor_role(p_actor) in ('admin','collector'),false) then raise exception 'Access denied' using errcode='42501'; end if;
  insert into public.properties(survey_number,property_name,village,taluk,district,owner_name,land_extent,land_extent_unit,remarks,created_by)
  values(p_data->>'survey_number',coalesce(p_data->>'property_name',''),coalesce(p_data->>'village',''),coalesce(p_data->>'taluk',''),coalesce(p_data->>'district',''),coalesce(p_data->>'owner_name',''),(p_data->>'land_extent')::numeric,coalesce(p_data->>'land_extent_unit','acres'),coalesce(p_data->>'remarks',''),p_actor) returning id into result;
  insert into public.property_members(property_id,user_id) values(result,p_actor);
 else
  perform private.require_access(p_actor,p_id,array['admin','collector']);
  select to_jsonb(p) into old_row from public.properties p where id=p_id for update;
  update public.properties set survey_number=p_data->>'survey_number',property_name=p_data->>'property_name',village=p_data->>'village',taluk=p_data->>'taluk',district=p_data->>'district',owner_name=p_data->>'owner_name',land_extent=(p_data->>'land_extent')::numeric,land_extent_unit=p_data->>'land_extent_unit',remarks=p_data->>'remarks' where id=p_id;
  result=p_id;
  -- Survey/location changes invalidate previous reviews.
  if (old_row->>'survey_number',old_row->>'village',old_row->>'taluk',old_row->>'district',old_row->>'owner_name') is distinct from (p_data->>'survey_number',p_data->>'village',p_data->>'taluk',p_data->>'district',p_data->>'owner_name') then
   update public.property_documents d set verification_status=case when exists(select 1 from public.uploaded_files f where f.property_document_id=d.id) then 'Uploaded' else 'Pending' end,reviewer_id=null,survey_match_status='Not Checked',rejection_reason='' where property_id=p_id;
  end if;
 end if;
 perform private.audit(p_actor,result,null,case when p_id is null then 'property.created' else 'property.updated' end,old_row,p_data);
 return result;
end $$;

create function public.update_document(p_actor uuid,p_document uuid,p_data jsonb,p_review boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare d public.property_documents; has_files boolean; target text;
begin
 select * into strict d from public.property_documents where id=p_document for update;
 perform private.require_access(p_actor,d.property_id,case when p_review then array['admin','reviewer'] else array['admin','collector','reviewer'] end);
 select exists(select 1 from public.uploaded_files where property_document_id=d.id) into has_files;
 if p_review then
  target=p_data->>'verification_status';
  if not has_files or target not in ('Under Review','Verified','Rejected') then raise exception 'Upload a file before review' using errcode='22023'; end if;
  if target='Rejected' and length(trim(coalesce(p_data->>'rejection_reason','')))=0 then raise exception 'Rejection reason required' using errcode='22023'; end if;
  if target='Verified' and p_data->>'survey_match_status' is distinct from 'Matches Survey Number' then raise exception 'Confirm the survey number match before verification' using errcode='22023'; end if;
  update public.property_documents set verification_status=target,survey_match_status=p_data->>'survey_match_status',reviewer_id=p_actor,remarks=coalesce(p_data->>'remarks',''),rejection_reason=case when target='Rejected' then p_data->>'rejection_reason' else '' end where id=d.id;
 else
  if coalesce((p_data->>'is_collected')::boolean,false) and not has_files then raise exception 'Upload a file before marking collected' using errcode='22023'; end if;
  update public.property_documents set is_collected=(p_data->>'is_collected')::boolean where id=d.id;
 end if;
 perform private.audit(p_actor,d.property_id,d.id,case when p_review then 'document.reviewed' else 'document.collection_changed' end,to_jsonb(d),p_data);
end $$;

create function public.commit_file(p_actor uuid,p_document uuid,p_file jsonb,p_replace uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare d public.property_documents; previous public.uploaded_files; result uuid;
begin
 select * into strict d from public.property_documents where id=p_document for update;
 perform private.require_access(p_actor,d.property_id,array['admin','collector','reviewer']);
 if p_replace is not null then
  perform private.require_access(p_actor,d.property_id,array['admin','collector']);
  select * into strict previous from public.uploaded_files where id=p_replace and property_document_id=d.id;
 end if;
 insert into public.uploaded_files(property_document_id,original_file_name,storage_path,mime_type,file_size,uploaded_by,replaced_at)
 values(d.id,p_file->>'original_file_name',p_file->>'storage_path',p_file->>'mime_type',(p_file->>'file_size')::bigint,p_actor,case when p_replace is not null then now() end) returning id into result;
 if p_replace is not null then
  insert into public.storage_cleanup(storage_path) values(previous.storage_path) on conflict do nothing;
  delete from public.uploaded_files where id=p_replace;
 end if;
 -- Every content change needs fresh review; collection remains an explicit user decision.
 update public.property_documents set verification_status='Uploaded',reviewer_id=null,survey_match_status='Not Checked',rejection_reason='' where id=d.id;
 perform private.audit(p_actor,d.property_id,d.id,case when p_replace is null then 'file.uploaded' else 'file.replaced' end,case when p_replace is not null then to_jsonb(previous) end,p_file||jsonb_build_object('id',result));
 return result;
end $$;

create function public.remove_file(p_actor uuid,p_file uuid) returns void language plpgsql security definer set search_path='' as $$
declare f public.uploaded_files; d public.property_documents;
begin
 select * into strict f from public.uploaded_files where id=p_file;
 select * into strict d from public.property_documents where id=f.property_document_id for update;
 perform private.require_access(p_actor,d.property_id,array['admin','collector']);
 delete from public.uploaded_files where id=f.id;
 if not found then raise exception 'File no longer exists' using errcode='P0002'; end if;
 insert into public.storage_cleanup(storage_path) values(f.storage_path) on conflict do nothing;
 update public.property_documents set is_collected=case when exists(select 1 from public.uploaded_files where property_document_id=d.id) then is_collected else false end,
 verification_status=case when exists(select 1 from public.uploaded_files where property_document_id=d.id) then 'Uploaded' else 'Pending' end,
 reviewer_id=null,survey_match_status='Not Checked',rejection_reason='' where id=d.id;
 perform private.audit(p_actor,d.property_id,d.id,'file.deleted',to_jsonb(f),null);
end $$;

create function public.manage_member(p_actor uuid,p_property uuid,p_user uuid,p_remove boolean default false) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_access(p_actor,p_property,array['admin']);
 if p_remove then delete from public.property_members where property_id=p_property and user_id=p_user;
 else insert into public.property_members(property_id,user_id) values(p_property,p_user) on conflict do nothing; end if;
 perform private.audit(p_actor,p_property,null,case when p_remove then 'member.removed' else 'member.added' end,null,jsonb_build_object('user_id',p_user));
end $$;
revoke all on function public.save_property(uuid,jsonb,uuid),public.update_document(uuid,uuid,jsonb,boolean),public.commit_file(uuid,uuid,jsonb,uuid),public.remove_file(uuid,uuid),public.manage_member(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.save_property(uuid,jsonb,uuid),public.update_document(uuid,uuid,jsonb,boolean),public.commit_file(uuid,uuid,jsonb,uuid),public.remove_file(uuid,uuid),public.manage_member(uuid,uuid,uuid,boolean) to service_role;
revoke all on all functions in schema private from public,anon,authenticated;
commit;
