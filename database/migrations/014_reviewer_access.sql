begin;

-- Grant reviewers access to projects and properties in RLS checks
create or replace function private.can_access_project(actor uuid, project uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id=actor and role in ('admin', 'reviewer'))
  or exists(select 1 from public.project_members where user_id=actor and project_id=project)
  or exists(select 1 from public.properties p join public.property_members m on m.property_id=p.id where p.project_id=project and m.user_id=actor)
$$;

create or replace function private.can_access(actor uuid, property uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id=actor and role in ('admin', 'reviewer'))
  or exists(select 1 from public.property_members where user_id=actor and property_id=property)
  or exists(select 1 from public.properties p join public.project_members m on m.project_id=p.project_id where p.id=property and m.user_id=actor)
$$;

-- Ensure all current reviewers are also members of all existing projects
insert into public.project_members (project_id, user_id)
select p.id, pr.id
from public.projects p
cross join public.profiles pr
where pr.role in ('admin', 'reviewer')
on conflict do nothing;

commit;

