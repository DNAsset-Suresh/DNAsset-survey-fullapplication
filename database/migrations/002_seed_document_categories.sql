begin;
insert into public.document_categories(name,description,display_order) values
 ('Title Documents','Registered deeds and the chain of title.',1),
 ('Field Measurement Book (FMB)','Survey sketch and field measurements.',2),
 ('Patta','Revenue record for the property.',3),
 ('Encumbrance Certificate (EC)','Recorded transactions and encumbrances.',4),
 ('Adangal','Land use and cultivation record.',5),
 ('Government Pleader Legal Opinion','Legal review by the appropriate qualified professional.',6),
 ('A-Register','Village land and revenue register.',7)
on conflict(name) do nothing;
create or replace function private.create_checklist() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.property_documents(property_id,document_category_id)
  select new.id,id from public.document_categories where is_active on conflict do nothing;
  return new;
end $$;
drop trigger if exists property_checklist on public.properties;
create trigger property_checklist after insert on public.properties for each row execute function private.create_checklist();
insert into public.properties(id,survey_number) values('21610000-0000-4000-8000-000000000001','216/1') on conflict do nothing;
insert into public.property_documents(property_id,document_category_id)
select p.id,c.id from public.properties p cross join public.document_categories c where c.is_active on conflict do nothing;
commit;
