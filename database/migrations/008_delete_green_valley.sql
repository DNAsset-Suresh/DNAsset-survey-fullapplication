begin;

-- Delete Green Valley project and all associated data
-- uploaded_files references property_document_id (not document_id)
-- Cascade handles: project_members, properties → property_documents → uploaded_files, property_members

-- 1. Remove uploaded_files linked to this project's property documents
delete from public.uploaded_files
where property_document_id in (
  select pd.id from public.property_documents pd
  join public.properties p on p.id = pd.property_id
  where p.project_id = '11111111-1111-4000-8000-000000000001'
);

-- 2. Delete the project (cascades handle the rest)
delete from public.projects
where id = '11111111-1111-4000-8000-000000000001';

commit;
