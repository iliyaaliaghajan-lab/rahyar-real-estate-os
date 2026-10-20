-- ============================================================
-- 002_business_tables_rls.sql
-- Complete tenant isolation for core business tables
-- ============================================================

-- Helper: reusable condition for "user belongs to this organization"
-- (already created in 001, repeated here for clarity)

-- ------------------------------------------------------------
-- clients
-- ------------------------------------------------------------
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'clients') then
    -- Drop previous policy if it exists (safe re-run)
    drop policy if exists "Tenant isolation for clients" on public.clients;

    execute $pol$
      create policy "Tenant isolation for clients"
        on public.clients for all
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

-- ------------------------------------------------------------
-- needs
-- ------------------------------------------------------------
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'needs') then
    drop policy if exists "Tenant isolation for needs" on public.needs;

    execute $pol$
      create policy "Tenant isolation for needs"
        on public.needs for all
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

-- ------------------------------------------------------------
-- follow_ups
-- ------------------------------------------------------------
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'follow_ups') then
    drop policy if exists "Tenant isolation for follow_ups" on public.follow_ups;

    execute $pol$
      create policy "Tenant isolation for follow_ups"
        on public.follow_ups for all
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

-- ------------------------------------------------------------
-- activities
-- ------------------------------------------------------------
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'activities') then
    drop policy if exists "Tenant isolation for activities" on public.activities;

    execute $pol$
      create policy "Tenant isolation for activities"
        on public.activities for all
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

-- ============================================================
-- End of 002_business_tables_rls.sql
-- ============================================================
