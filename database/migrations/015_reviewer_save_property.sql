begin;

-- Allow reviewers to create and edit survey numbers
create or replace function public.save_property(p_actor uuid, p_data jsonb, p_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; old_row jsonb;
begin
 if p_id is null then
  if not coalesce(private.actor_role(p_actor) in ('admin','collector','reviewer'), false) then raise exception 'Access denied' using errcode='42501'; end if;
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
  perform private.require_access(p_actor, p_id, array['admin','collector','reviewer']);
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

commit;
