begin;
create function private.actor_role(actor uuid) returns text language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id=actor
$$;
create function private.can_access(actor uuid, property uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id=actor and role='admin')
  or exists(select 1 from public.property_members where user_id=actor and property_id=property)
$$;
create function public.can_access_property(property uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_access(auth.uid(),property)
$$;
create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.actor_role(auth.uid())='admin',false)
$$;
revoke all on function public.can_access_property(uuid), public.is_admin() from public, anon;
grant execute on function public.can_access_property(uuid), public.is_admin() to authenticated;
alter table profiles enable row level security;
alter table properties enable row level security;
alter table property_members enable row level security;
alter table document_categories enable row level security;
alter table property_documents enable row level security;
alter table uploaded_files enable row level security;
alter table audit_logs enable row level security;
alter table storage_cleanup enable row level security;
-- Browser clients have read-only access; all mutations go through the authenticated Express API.
revoke all on profiles, properties, property_members, document_categories, property_documents, uploaded_files, audit_logs, storage_cleanup from anon, authenticated;
grant select on profiles, properties, property_members, document_categories, property_documents, uploaded_files, audit_logs to authenticated;
grant all on profiles, properties, property_members, document_categories, property_documents, uploaded_files, audit_logs, storage_cleanup to service_role;
create policy profiles_read on profiles for select to authenticated using
 (id=auth.uid() or public.is_admin()
 or exists(select 1 from public.property_members m where m.user_id=profiles.id and public.can_access_property(m.property_id))
 or exists(select 1 from public.property_documents d where d.reviewer_id=profiles.id and public.can_access_property(d.property_id))
 or exists(select 1 from public.uploaded_files f join public.property_documents d on d.id=f.property_document_id where f.uploaded_by=profiles.id and public.can_access_property(d.property_id))
 or exists(select 1 from public.audit_logs a where a.actor_id=profiles.id and public.can_access_property(a.property_id)));
create policy properties_read on properties for select to authenticated using(public.can_access_property(id));
create policy memberships_read on property_members for select to authenticated using(public.can_access_property(property_id));
create policy categories_read on document_categories for select to authenticated using(true);
create policy checklist_read on property_documents for select to authenticated using(public.can_access_property(property_id));
create policy files_read on uploaded_files for select to authenticated using(exists
 (select 1 from public.property_documents d where d.id=property_document_id and public.can_access_property(d.property_id)));
create policy audit_read on audit_logs for select to authenticated using(public.can_access_property(property_id));

create view public.property_progress with (security_invoker=true) as
select p.id as property_id, count(d.id)::integer as required,
 count(d.id) filter(where d.is_collected and exists(select 1 from public.uploaded_files f where f.property_document_id=d.id))::integer as collected,
 (count(d.id)-count(d.id) filter(where d.is_collected and exists(select 1 from public.uploaded_files f where f.property_document_id=d.id)))::integer as pending,
 count(d.id) filter(where d.verification_status='Verified' and exists(select 1 from public.uploaded_files f where f.property_document_id=d.id))::integer as verified,
 count(d.id) filter(where d.verification_status='Rejected')::integer as rejected,
 count(d.id) filter(where d.verification_status='Under Review')::integer as under_review,
 round(100.0*count(d.id) filter(where d.is_collected and exists(select 1 from public.uploaded_files f where f.property_document_id=d.id))/7,2) as collection_percentage,
 round(100.0*count(d.id) filter(where d.verification_status='Verified' and exists(select 1 from public.uploaded_files f where f.property_document_id=d.id))/7,2) as verification_percentage
from public.properties p left join public.property_documents d on d.property_id=p.id group by p.id;
grant select on property_progress to authenticated,service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('land-documents','land-documents',false,20971520,array['application/pdf','image/jpeg','image/png']) on conflict(id) do nothing;
-- Deliberately no client storage policies. Express checks record access before issuing a 60-second signed URL.
-- Use a dedicated bucket; do not add permissive storage.objects policies for it.
commit;
