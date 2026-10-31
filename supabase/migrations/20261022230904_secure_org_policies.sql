-- ============================================================
-- 003_secure_org_policies.sql
-- Secure org creation RPC + membership visibility
-- ============================================================
-- Prerequisites: 001 (tables, RLS, user_organization_ids, table grants)
-- Does NOT create business tables.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Helper alias (same semantics as user_organization_ids in 001)
-- ------------------------------------------------------------
create or replace function public.user_active_organization_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id
  from public.organization_members
  where user_id = auth.uid()
    and status = 'active';
$$;

revoke all on function public.user_active_organization_ids() from public;
revoke all on function public.user_active_organization_ids() from anon;
grant execute on function public.user_active_organization_ids() to authenticated;

comment on function public.user_active_organization_ids() is
  'Active organization IDs for current user. SECURITY DEFINER; search_path empty.';

-- ------------------------------------------------------------
-- 2. Atomic organization + owner membership
--    Client only passes name. Identity/role fixed server-side.
--    Writes run as function owner (SECURITY DEFINER), not as
--    authenticated table INSERT privileges (revoked in 001).
-- ------------------------------------------------------------
create or replace function public.create_organization_with_owner(p_name text)
returns table (organization_id uuid, organization_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_org_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_name is null or length(trim(p_name)) < 2 then
    raise exception 'Invalid organization name';
  end if;

  v_org_name := trim(p_name);

  insert into public.organizations (name)
  values (v_org_name)
  returning id, name into v_org_id, v_org_name;

  insert into public.organization_members (
    organization_id,
    user_id,
    role,
    status,
    joined_at
  ) values (
    v_org_id,
    v_uid,
    'owner',
    'active',
    now()
  );

  return query select v_org_id, v_org_name;
end;
$$;

revoke all on function public.create_organization_with_owner(text) from public;
revoke all on function public.create_organization_with_owner(text) from anon;
grant execute on function public.create_organization_with_owner(text) to authenticated;

comment on function public.create_organization_with_owner(text) is
  'Creates organization and owner membership atomically. Client cannot supply user_id or role.';

-- ------------------------------------------------------------
-- 3. SELECT policies for organizations / members (no write policies)
-- ------------------------------------------------------------
drop policy if exists "Users can view their organizations" on public.organizations;

create policy "Users can view their organizations"
  on public.organizations
  for select
  to authenticated
  using (
    id in (select public.user_active_organization_ids())
  );

drop policy if exists "Users can view their memberships" on public.organization_members;
drop policy if exists "Members can view organization members" on public.organization_members;

create policy "Members can view organization members"
  on public.organization_members
  for select
  to authenticated
  using (
    organization_id in (select public.user_active_organization_ids())
  );

-- No INSERT/UPDATE/DELETE policies on organizations or organization_members.
-- Forging membership/role via direct client DML is blocked by missing policies
-- plus revoked INSERT/UPDATE/DELETE grants on these tables (001).

-- ============================================================
-- End of 003_secure_org_policies.sql
-- ============================================================
