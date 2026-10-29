-- ============================================================
-- 002_business_tables_rls.sql
-- Tenant isolation for business tables (if they already exist)
-- ============================================================
-- Does NOT create properties/clients/needs/follow_ups/activities.
-- Depends on public.user_organization_ids() from 001.
-- ============================================================

-- clients
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'clients') then
    drop policy if exists "Tenant isolation for clients" on public.clients;

    execute $pol$
      create policy "Tenant isolation for clients"
        on public.clients for all
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

-- needs
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'needs') then
    drop policy if exists "Tenant isolation for needs" on public.needs;

    execute $pol$
      create policy "Tenant isolation for needs"
        on public.needs for all
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

-- follow_ups
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'follow_ups') then
    drop policy if exists "Tenant isolation for follow_ups" on public.follow_ups;

    execute $pol$
      create policy "Tenant isolation for follow_ups"
        on public.follow_ups for all
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

-- activities
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'activities') then
    drop policy if exists "Tenant isolation for activities" on public.activities;

    execute $pol$
      create policy "Tenant isolation for activities"
        on public.activities for all
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

-- properties (aligned with 001 if present)
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'properties') then
    drop policy if exists "Tenant isolation for properties" on public.properties;

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
-- End of 002_business_tables_rls.sql
-- ============================================================
