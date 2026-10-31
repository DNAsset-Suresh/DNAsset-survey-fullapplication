-- Founder accounts use the admin role. Reviewers may delete their own files.
create or replace function public.remove_file(p_actor uuid, p_file uuid) returns void language plpgsql security definer set search_path='' as $$
declare f public.uploaded_files; d public.property_documents;
begin
 select * into strict f from public.uploaded_files where id=p_file;
 select * into strict d from public.property_documents where id=f.property_document_id for update;
 perform private.require_access(p_actor, d.property_id, array['admin', 'reviewer']);
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

