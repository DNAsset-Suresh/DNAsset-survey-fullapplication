begin;

-- 1. Migrate any existing profiles that had collector, viewer, or user roles to 'reviewer'
update public.profiles
set role = 'reviewer'
where role not in ('admin', 'reviewer');

-- 2. Update default role to 'reviewer'
alter table public.profiles alter column role set default 'reviewer';

-- 3. Update profiles_role_check constraint to only permit 'admin' and 'reviewer'
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'reviewer'));

commit;

