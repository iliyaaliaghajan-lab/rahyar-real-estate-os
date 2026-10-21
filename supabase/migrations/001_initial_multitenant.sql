-- ============================================================
-- 001_initial_multitenant.sql
-- اتحاد / رهیار — Multi-tenant foundation
-- ============================================================
-- This migration creates the core multi-tenant structure.
-- It does NOT migrate any existing local (IndexedDB) data.
-- Run this in the Supabase SQL Editor or via the CLI after review.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Organizations (آژانس / مجموعه)
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
-- 2. Profiles (extends auth.users)
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
-- 3. Organization Members (membership + role)
-- ------------------------------------------------------------
create type public.member_role as enum ('owner', 'admin', 'agent');
create type public.member_status as enum ('active', 'invited', 'disabled');

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
-- 4. Add organization_id to core business tables
--    (these tables may already exist in a previous Supabase project;
--     the statements are written to be safe if columns are missing)
-- ------------------------------------------------------------

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'organization_id'
  ) then
    alter table public.properties add column organization_id uuid references public.organizations(id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients' and column_name = 'organization_id'
  ) then
    alter table public.clients add column organization_id uuid references public.organizations(id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'needs' and column_name = 'organization_id'
  ) then
    alter table public.needs add column organization_id uuid references public.organizations(id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'follow_ups' and column_name = 'organization_id'
  ) then
    alter table public.follow_ups add column organization_id uuid references public.organizations(id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activities' and column_name = 'organization_id'
  ) then
    alter table public.activities add column organization_id uuid references public.organizations(id);
  end if;
end $$;

-- Helpful indexes (only when table + organization_id column exist)
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
-- 5. Enable Row Level Security
-- ------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;

-- Business tables (only if they exist)
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
-- 6. Basic RLS Policies (Phase 1 — conservative)
-- ------------------------------------------------------------

-- Profiles: users can read/update their own profile
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Organization members: a user can see memberships they belong to
create policy "Users can view their memberships"
  on public.organization_members for select
  using (auth.uid() = user_id);

-- Organizations: a user can see organizations they are an active member of
create policy "Users can view their organizations"
  on public.organizations for select
  using (
    id in (
      select organization_id
      from public.organization_members
      where user_id = auth.uid() and status = 'active'
    )
  );

-- Business data isolation (example for properties — same pattern for others)
-- These policies assume the tables already exist.
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'properties') then
    execute $pol$
      create policy "Tenant isolation for properties"
        on public.properties for all
        using (
          organization_id in (
            select organization_id
            from public.organization_members
            where user_id = auth.uid() and status = 'active'
          )
        )
        with check (
          organization_id in (
            select organization_id
            from public.organization_members
            where user_id = auth.uid() and status = 'active'
          )
        );
    $pol$;
  end if;
end $$;

-- Note: Similar policies for clients, needs, follow_ups, activities
-- will be added in a follow-up migration after the tables are confirmed.

-- ------------------------------------------------------------
-- 7. Helper function: get current user's active organization ids
-- ------------------------------------------------------------
create or replace function public.user_organization_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.organization_members
  where user_id = auth.uid() and status = 'active';
$$;

comment on function public.user_organization_ids is 'Returns organization IDs the current user belongs to (active only)';

-- ============================================================
-- End of 001_initial_multitenant.sql
-- ============================================================
