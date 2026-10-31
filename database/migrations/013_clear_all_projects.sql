begin;

-- Delete ALL uploaded files (linked to property documents)
delete from public.uploaded_files;

-- Delete ALL properties (survey numbers) - cascades to property_documents, property_members
delete from public.properties;

-- Delete ALL projects - cascades to project_members
delete from public.projects;

commit;
