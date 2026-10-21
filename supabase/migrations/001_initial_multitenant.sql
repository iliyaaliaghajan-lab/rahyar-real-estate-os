-- ============================================================
-- 001_initial_multitenant.sql
-- اتحاد / رهیار — Multi-tenant foundation (security-hardened)
-- ============================================================
-- Creates core multi-tenant structure. Does NOT migrate IndexedDB data.
-- Business tables are NOT created here; only altered if they already exist.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Organizations
-- ------------------------------------------------------------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organizations is 'Real-estate agencies / teams (tenant root)';

-- ------------------------------------------------------------
-- 2. Profiles
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Public profile data linked 1:1 with auth.users';

-- ------------------------------------------------------------
-- 3. Enums (safe on re-run)
-- ------------------------------------------------------------
do $$ begin
  create type public.member_role as enum ('owner', 'admin', 'agent');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.member_status as enum ('active', 'invited', 'disabled');
exception
  when duplicate_object then null;
end $$;

-- ------------------------------------------------------------
-- 4. Organization members
-- ------------------------------------------------------------
create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'agent',
  status public.member_status not null default 'invited',
  invited_at timestamptz default now(),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, user_id)
);

create index if not exists idx_org_members_user on public.organization_members(user_id);
create index if not exists idx_org_members_org on public.organization_members(organization_id);

comment on table public.organization_members is 'Links users to organizations with role and status';

-- ------------------------------------------------------------
-- 5. organization_id on business tables (only if table exists)
-- ------------------------------------------------------------
do $$ begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'properties'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'organization_id'
  ) then
    alter table public.properties add column organization_id uuid references public.organizations(id);
  end if;
end $$;

do $$ begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'clients'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients' and column_name = 'organization_id'
  ) then
    alter table public.clients add column organization_id uuid references public.organizations(id);
  end if;
end $$;

do $$ begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'needs'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'needs' and column_name = 'organization_id'
  ) then
    alter table public.needs add column organization_id uuid references public.organizations(id);
  end if;
end $$;

do $$ begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'follow_ups'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'follow_ups' and column_name = 'organization_id'
  ) then
    alter table public.follow_ups add column organization_id uuid references public.organizations(id);
  end if;
end $$;

do $$ begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'activities'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activities' and column_name = 'organization_id'
  ) then
    alter table public.activities add column organization_id uuid references public.organizations(id);
  end if;
end $$;

-- Indexes only when table + column exist
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'organization_id'
  ) then
    create index if not exists idx_properties_org on public.properties(organization_id);
  end if;
end $$;

do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients' and column_name = 'organization_id'
  ) then
    create index if not exists idx_clients_org on public.clients(organization_id);
  end if;
end $$;

do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'needs' and column_name = 'organization_id'
  ) then
    create index if not exists idx_needs_org on public.needs(organization_id);
  end if;
end $$;

do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'follow_ups' and column_name = 'organization_id'
  ) then
    create index if not exists idx_follow_ups_org on public.follow_ups(organization_id);
  end if;
end $$;

do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activities' and column_name = 'organization_id'
  ) then
    create index if not exists idx_activities_org on public.activities(organization_id);
  end if;
end $$;

-- ------------------------------------------------------------
-- 6. Enable RLS
-- ------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;

do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'properties') then
    alter table public.properties enable row level security;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'clients') then
    alter table public.clients enable row level security;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'needs') then
    alter table public.needs enable row level security;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'follow_ups') then
    alter table public.follow_ups enable row level security;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'activities') then
    alter table public.activities enable row level security;
  end if;
end $$;

-- ------------------------------------------------------------
-- 7. Helper: active organization IDs (hardened)
--    Used by RLS to avoid recursive policy evaluation.
-- ------------------------------------------------------------
create or replace function public.user_organization_ids()
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

revoke all on function public.user_organization_ids() from public;
revoke all on function public.user_organization_ids() from anon;
grant execute on function public.user_organization_ids() to authenticated;

comment on function public.user_organization_ids() is
  'Returns organization IDs where the current user is an active member. SECURITY DEFINER; search_path empty.';

-- ------------------------------------------------------------
-- 8. Table privileges (minimum; does not alter service_role bypass)
--    REVOKE ALL clears SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER
--    from PUBLIC / anon / authenticated before granting only what is needed.
-- ------------------------------------------------------------
revoke all on table public.organizations from public;
revoke all on table public.organizations from anon;
revoke all on table public.organizations from authenticated;
grant select on table public.organizations to authenticated;
-- no direct INSERT/UPDATE/DELETE for authenticated (writes via RPC in 003)

revoke all on table public.organization_members from public;
revoke all on table public.organization_members from anon;
revoke all on table public.organization_members from authenticated;
grant select on table public.organization_members to authenticated;
-- no direct INSERT/UPDATE/DELETE for authenticated (owner row via RPC)

revoke all on table public.profiles from public;
revoke all on table public.profiles from anon;
revoke all on table public.profiles from authenticated;
grant select, update on table public.profiles to authenticated;
-- no INSERT for authenticated here (profile creation is a later concern)

-- Business tables: only if they exist; allow DML under RLS, deny anon
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'properties') then
    execute 'revoke all on table public.properties from public';
    execute 'revoke all on table public.properties from anon';
    execute 'grant select, insert, update, delete on table public.properties to authenticated';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'clients') then
    execute 'revoke all on table public.clients from public';
    execute 'revoke all on table public.clients from anon';
    execute 'grant select, insert, update, delete on table public.clients to authenticated';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'needs') then
    execute 'revoke all on table public.needs from public';
    execute 'revoke all on table public.needs from anon';
    execute 'grant select, insert, update, delete on table public.needs to authenticated';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'follow_ups') then
    execute 'revoke all on table public.follow_ups from public';
    execute 'revoke all on table public.follow_ups from anon';
    execute 'grant select, insert, update, delete on table public.follow_ups to authenticated';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'activities') then
    execute 'revoke all on table public.activities from public';
    execute 'revoke all on table public.activities from anon';
    execute 'grant select, insert, update, delete on table public.activities to authenticated';
  end if;
end $$;

-- ------------------------------------------------------------
-- 9. RLS policies (re-run safe)
-- ------------------------------------------------------------
drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;

create policy "Users can view own profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "Users can view their memberships" on public.organization_members;
drop policy if exists "Members can view organization members" on public.organization_members;

-- Temporary narrow policy; 003 widens SELECT to all members of same org via helper
create policy "Users can view their memberships"
  on public.organization_members for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can view their organizations" on public.organizations;

create policy "Users can view their organizations"
  on public.organizations for select
  to authenticated
  using (
    id in (select public.user_organization_ids())
  );

-- properties isolation (only if table exists)
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'properties') then
    execute 'drop policy if exists "Tenant isolation for properties" on public.properties';
    execute $pol$
      create policy "Tenant isolation for properties"
        on public.properties for all
        to authenticated
        using (
          organization_id in (select public.user_organization_ids())
        )
        with check (
          organization_id in (select public.user_organization_ids())
        );
    $pol$;
  end if;
end $$;

-- ============================================================
-- End of 001_initial_multitenant.sql
-- ============================================================
