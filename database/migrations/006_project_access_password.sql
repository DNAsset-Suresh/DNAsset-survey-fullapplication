begin;

-- 1. Add access_password column to projects
alter table public.projects add column if not exists access_password text not null default '';

-- 2. Update private.can_access to include project_members access
create or replace function private.can_access(actor uuid, property uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id=actor and role='admin')
  or exists(select 1 from public.property_members where user_id=actor and property_id=property)
  or exists(select 1 from public.properties p join public.project_members m on m.project_id=p.project_id where p.id=property and m.user_id=actor)
$$;

-- 3. Update save_property RPC function to support project_id and subdivision_number
create or replace function public.save_property(p_actor uuid, p_data jsonb, p_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; old_row jsonb;
begin
 if p_id is null then
  if not coalesce(private.actor_role(p_actor) in ('admin','collector'), false) then raise exception 'Access denied' using errcode='42501'; end if;
  insert into public.properties(
    project_id, survey_number, subdivision_number, patta_number, property_name,
    village, taluk, district, owner_name, land_extent, land_extent_unit, status, remarks, created_by
  ) values (
    case when p_data ? 'project_id' and p_data->>'project_id' is not null and length(trim(p_data->>'project_id')) > 0 then (p_data->>'project_id')::uuid else null end,
    p_data->>'survey_number',
    coalesce(p_data->>'subdivision_number', ''),
    coalesce(p_data->>'patta_number', ''),
    coalesce(p_data->>'property_name', ''),
    coalesce(p_data->>'village', ''),
    coalesce(p_data->>'taluk', ''),
    coalesce(p_data->>'district', ''),
    coalesce(p_data->>'owner_name', ''),
    (p_data->>'land_extent')::numeric,
    coalesce(p_data->>'land_extent_unit', 'acres'),
    coalesce(p_data->>'status', 'Active'),
    coalesce(p_data->>'remarks', ''),
    p_actor
  ) returning id into result;

  insert into public.property_members(property_id, user_id) values(result, p_actor);

  -- Auto create document slots for the survey number
  insert into public.property_documents(property_id, document_category_id)
  select result, id from public.document_categories where is_active
  on conflict do nothing;
 else
  perform private.require_access(p_actor, p_id, array['admin','collector']);
  select to_jsonb(p) into old_row from public.properties p where id=p_id for update;
  update public.properties set
    project_id = case when p_data ? 'project_id' and p_data->>'project_id' is not null and length(trim(p_data->>'project_id')) > 0 then (p_data->>'project_id')::uuid else project_id end,
    survey_number = p_data->>'survey_number',
    subdivision_number = coalesce(p_data->>'subdivision_number', subdivision_number),
    patta_number = coalesce(p_data->>'patta_number', patta_number),
    property_name = coalesce(p_data->>'property_name', property_name),
    village = coalesce(p_data->>'village', village),
    taluk = coalesce(p_data->>'taluk', taluk),
    district = coalesce(p_data->>'district', district),
    owner_name = coalesce(p_data->>'owner_name', owner_name),
    land_extent = (p_data->>'land_extent')::numeric,
    land_extent_unit = coalesce(p_data->>'land_extent_unit', land_extent_unit),
    status = coalesce(p_data->>'status', status),
    remarks = coalesce(p_data->>'remarks', remarks)
  where id = p_id;
  result = p_id;
 end if;
 perform private.audit(p_actor, result, null, case when p_id is null then 'property.created' else 'property.updated' end, old_row, p_data);
 return result;
end $$;

-- 4. Update save_project RPC function to support access_password
create or replace function public.save_project(p_actor uuid, p_data jsonb, p_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; old_row jsonb;
begin
  if p_id is null then
    if not coalesce(private.actor_role(p_actor) in ('admin','collector'), false) then
      raise exception 'Access denied' using errcode='42501';
    end if;
    insert into public.projects(
      project_name, project_code, description, promoter_name,
      village, taluk, district, project_address,
      total_land_extent, measurement_unit, status, remarks, created_by,
      access_password
    ) values (
      p_data->>'project_name',
      coalesce(p_data->>'project_code', ''),
      coalesce(p_data->>'description', ''),
      coalesce(p_data->>'promoter_name', ''),
      coalesce(p_data->>'village', ''),
      coalesce(p_data->>'taluk', ''),
      coalesce(p_data->>'district', ''),
      coalesce(p_data->>'project_address', ''),
      (p_data->>'total_land_extent')::numeric,
      coalesce(p_data->>'measurement_unit', 'acres'),
      coalesce(p_data->>'status', 'Active'),
      coalesce(p_data->>'remarks', ''),
      p_actor,
      coalesce(p_data->>'access_password', '')
    ) returning id into result;
    insert into public.project_members(project_id, user_id) values(result, p_actor) on conflict do nothing;
  else
    if not coalesce(private.actor_role(p_actor) in ('admin','collector'), false) then
      raise exception 'Access denied' using errcode='42501';
    end if;
    select to_jsonb(pr) into old_row from public.projects pr where id = p_id for update;
    if old_row is null then raise exception 'Project not found' using errcode='P0002'; end if;
    update public.projects set
      project_name = p_data->>'project_name',
      project_code = coalesce(p_data->>'project_code', ''),
      description = coalesce(p_data->>'description', ''),
      promoter_name = coalesce(p_data->>'promoter_name', ''),
      village = coalesce(p_data->>'village', ''),
      taluk = coalesce(p_data->>'taluk', ''),
      district = coalesce(p_data->>'district', ''),
      project_address = coalesce(p_data->>'project_address', ''),
      total_land_extent = (p_data->>'total_land_extent')::numeric,
      measurement_unit = coalesce(p_data->>'measurement_unit', 'acres'),
      status = coalesce(p_data->>'status', 'Active'),
      remarks = coalesce(p_data->>'remarks', ''),
      access_password = case when p_data ? 'access_password' then coalesce(p_data->>'access_password', '') else access_password end
    where id = p_id;
    result = p_id;
  end if;
  return result;
end $$;

-- 5. Set default access password for Green Valley: 'greenvalley123'
update public.projects
set access_password = 'greenvalley123'
where id = '11111111-1111-4000-8000-000000000001' and (access_password is null or access_password = '');

commit;
