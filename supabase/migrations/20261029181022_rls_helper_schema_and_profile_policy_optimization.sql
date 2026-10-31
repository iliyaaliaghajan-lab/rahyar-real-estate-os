-- ============================================================
-- 008_rls_helper_schema_and_profile_policy_optimization.sql
-- Move RLS helper functions out of public into private schema;
-- consolidate profile SELECT policies; keep intentional invitation lock-down.
-- ============================================================
-- Status in repository: authored only until explicitly applied to an environment.
-- Do NOT treat presence of this file as "applied on Staging".
--
-- PRE-APPLY GATE (Dashboard / project settings — do not change from this SQL):
-- Confirm schema "private" is NOT exposed via the Supabase Data API (exposed
-- schemas list). RLS helpers must not be RPC-callable from the client API surface.
-- Document environment status in docs/; do not rewrite prior migration history.
--
-- Does NOT alter signatures, grants, or bodies of:
--   public.create_organization_with_owner
--   public.create_organization_invitation
--   public.accept_organization_invitation
-- ============================================================

-- ------------------------------------------------------------
-- 1. Internal schema for RLS helpers
-- ------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;

-- SECURITY PREFLIGHT A
DO $ownership_preflight$
DECLARE
  v_server_version_num integer := current_setting('server_version_num')::integer;
  v_roles_found integer;
  v_object_label text;
  v_owner_role_oid oid;
  v_api_role_name text;
  v_api_role_oid oid;
BEGIN
  SELECT count(*)::integer INTO v_roles_found FROM pg_catalog.pg_roles WHERE rolname IN ('anon', 'authenticated');
  IF v_roles_found <> 2 THEN
    RAISE EXCEPTION USING ERRCODE = '42704', MESSAGE = 'SECURITY PREFLIGHT FAILED: expected Supabase API roles "anon" and "authenticated" to exist.';
  END IF;
  FOR v_object_label, v_owner_role_oid IN
    SELECT 'schema private'::text, n.nspowner FROM pg_catalog.pg_namespace AS n WHERE n.nspname = 'private'
    UNION ALL
    SELECT 'function private.user_organization_ids()'::text, p.proowner FROM pg_catalog.pg_proc AS p WHERE p.oid = pg_catalog.to_regprocedure('private.user_organization_ids()')::oid
  LOOP
    FOR v_api_role_name, v_api_role_oid IN SELECT r.rolname, r.oid FROM pg_catalog.pg_roles AS r WHERE r.rolname IN ('anon', 'authenticated')
    LOOP
      IF v_api_role_oid = v_owner_role_oid OR pg_catalog.pg_has_role(v_api_role_oid, v_owner_role_oid, 'USAGE') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = pg_catalog.format('SECURITY PREFLIGHT FAILED: API role "%s" is the owner or can inherit the owner role "%s" for %s.', v_api_role_name, (SELECT r.rolname FROM pg_catalog.pg_roles AS r WHERE r.oid = v_owner_role_oid), v_object_label);
      END IF;
      IF v_server_version_num >= 160000 THEN
        IF pg_catalog.pg_has_role(v_api_role_oid, v_owner_role_oid, 'SET') THEN
          RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = pg_catalog.format('SECURITY PREFLIGHT FAILED: API role "%s" can SET ROLE to owner role "%s" for %s.', v_api_role_name, (SELECT r.rolname FROM pg_catalog.pg_roles AS r WHERE r.oid = v_owner_role_oid), v_object_label);
        END IF;
      ELSE
        IF pg_catalog.pg_has_role(v_api_role_oid, v_owner_role_oid, 'MEMBER') THEN
          RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = pg_catalog.format('SECURITY PREFLIGHT FAILED: API role "%s" can become owner role "%s" for %s through role membership.', v_api_role_name, (SELECT r.rolname FROM pg_catalog.pg_roles AS r WHERE r.oid = v_owner_role_oid), v_object_label);
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END;
$ownership_preflight$;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon;
REVOKE ALL ON SCHEMA private FROM authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

COMMENT ON SCHEMA private IS 'Internal helpers for RLS. Must not be listed in Data API exposed schemas.';

-- SECURITY PREFLIGHT B
DO $create_preflight$
DECLARE
  v_server_version_num integer := current_setting('server_version_num')::integer;
  v_api_role_name text;
  v_api_role_oid oid;
  v_candidate_role_oid oid;
  v_candidate_role_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'private') THEN
    RAISE EXCEPTION USING ERRCODE = '3F000', MESSAGE = 'SECURITY PREFLIGHT FAILED: schema private does not exist after setup.';
  END IF;
  FOR v_api_role_name, v_api_role_oid IN SELECT r.rolname, r.oid FROM pg_catalog.pg_roles AS r WHERE r.rolname IN ('anon', 'authenticated')
  LOOP
    IF has_schema_privilege(v_api_role_oid, 'private', 'CREATE') THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = pg_catalog.format('SECURITY PREFLIGHT FAILED: API role "%s" still has effective CREATE on schema private after grants were normalized.', v_api_role_name);
    END IF;
    FOR v_candidate_role_name, v_candidate_role_oid IN
      SELECT r.rolname, r.oid FROM pg_catalog.pg_roles AS r
      WHERE r.rolname NOT IN ('anon', 'authenticated', 'pg_signal_backend') AND has_schema_privilege(r.oid, 'private', 'CREATE')
    LOOP
      IF v_api_role_oid = v_candidate_role_oid OR pg_catalog.pg_has_role(v_api_role_oid, v_candidate_role_oid, 'USAGE') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = pg_catalog.format('SECURITY PREFLIGHT FAILED: API role "%s" can obtain CREATE on schema private through role "%s" privileges.', v_api_role_name, v_candidate_role_name);
      END IF;
      IF v_server_version_num >= 160000 THEN
        IF pg_catalog.pg_has_role(v_api_role_oid, v_candidate_role_oid, 'SET') THEN
          RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = pg_catalog.format('SECURITY PREFLIGHT FAILED: API role "%s" can SET ROLE to "%s", which has effective CREATE on schema private.', v_api_role_name, v_candidate_role_name);
        END IF;
      ELSE
        IF pg_catalog.pg_has_role(v_api_role_oid, v_candidate_role_oid, 'MEMBER') THEN
          RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = pg_catalog.format('SECURITY PREFLIGHT FAILED: API role "%s" can become role "%s", which has effective CREATE on schema private.', v_api_role_name, v_candidate_role_name);
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END;
$create_preflight$;

CREATE OR REPLACE FUNCTION private.user_organization_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT om.organization_id FROM public.organization_members AS om
  WHERE om.user_id = (SELECT auth.uid()) AND om.status = 'active';
$$;

REVOKE ALL ON FUNCTION private.user_organization_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.user_organization_ids() FROM anon;
REVOKE ALL ON FUNCTION private.user_organization_ids() FROM authenticated;
GRANT EXECUTE ON FUNCTION private.user_organization_ids() TO authenticated;

COMMENT ON FUNCTION private.user_organization_ids() IS 'Active organization IDs for the current user. SECURITY DEFINER; empty search_path. For RLS evaluation only.';

-- SECURITY PREFLIGHT C
DO $function_owner_preflight$
DECLARE
  v_server_version_num integer := current_setting('server_version_num')::integer;
  v_function_owner_oid oid;
  v_api_role_name text;
  v_api_role_oid oid;
BEGIN
  SELECT p.proowner INTO v_function_owner_oid FROM pg_catalog.pg_proc AS p WHERE p.oid = pg_catalog.to_regprocedure('private.user_organization_ids()')::oid;
  IF v_function_owner_oid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42883', MESSAGE = 'SECURITY PREFLIGHT FAILED: private.user_organization_ids() was not found after creation.';
  END IF;
  FOR v_api_role_name, v_api_role_oid IN SELECT r.rolname, r.oid FROM pg_catalog.pg_roles AS r WHERE r.rolname IN ('anon', 'authenticated')
  LOOP
    IF v_api_role_oid = v_function_owner_oid OR pg_catalog.pg_has_role(v_api_role_oid, v_function_owner_oid, 'USAGE') THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = pg_catalog.format('SECURITY PREFLIGHT FAILED: API role "%s" is the owner or can inherit privileges of function owner "%s" for private.user_organization_ids().', v_api_role_name, (SELECT r.rolname FROM pg_catalog.pg_roles AS r WHERE r.oid = v_function_owner_oid));
    END IF;
    IF v_server_version_num >= 160000 THEN
      IF pg_catalog.pg_has_role(v_api_role_oid, v_function_owner_oid, 'SET') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = pg_catalog.format('SECURITY PREFLIGHT FAILED: API role "%s" can SET ROLE to function owner "%s" for private.user_organization_ids().', v_api_role_name, (SELECT r.rolname FROM pg_catalog.pg_roles AS r WHERE r.oid = v_function_owner_oid));
      END IF;
    ELSE
      IF pg_catalog.pg_has_role(v_api_role_oid, v_function_owner_oid, 'MEMBER') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = pg_catalog.format('SECURITY PREFLIGHT FAILED: API role "%s" can become function owner "%s" through role membership.', v_api_role_name, (SELECT r.rolname FROM pg_catalog.pg_roles AS r WHERE r.oid = v_function_owner_oid));
      END IF;
    END IF;
  END LOOP;
END;
$function_owner_preflight$;

DROP POLICY IF EXISTS "Users can view their organizations" ON public.organizations;
CREATE POLICY "Users can view their organizations" ON public.organizations FOR SELECT TO authenticated USING (id IN (SELECT private.user_organization_ids()));

DROP POLICY IF EXISTS "Users can view their memberships" ON public.organization_members;
DROP POLICY IF EXISTS "Members can view organization members" ON public.organization_members;
CREATE POLICY "Members can view organization members" ON public.organization_members FOR SELECT TO authenticated USING (organization_id IN (SELECT private.user_organization_ids()));

DO $tenant_policies$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['properties', 'clients', 'needs', 'follow_ups', 'activities']
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t)
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'organization_id') THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Tenant isolation for ' || t, t);
      EXECUTE format($pol$
          CREATE POLICY %I ON public.%I FOR ALL TO authenticated
            USING (organization_id IN (SELECT private.user_organization_ids()))
            WITH CHECK (organization_id IN (SELECT private.user_organization_ids()))
        $pol$, 'Tenant isolation for ' || t, t);
    END IF;
  END LOOP;
END;
$tenant_policies$;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view profiles in same organization" ON public.profiles;
DROP POLICY IF EXISTS "Users can view profiles in their organizations" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can view accessible profiles" ON public.profiles FOR SELECT TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR id IN (
      SELECT om.user_id FROM public.organization_members AS om
      WHERE om.status = 'active' AND om.organization_id IN (SELECT private.user_organization_ids())
    )
  );

CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));

DROP FUNCTION IF EXISTS public.user_organization_ids();
DROP FUNCTION IF EXISTS public.user_active_organization_ids();

REVOKE ALL ON TABLE public.organization_invitations FROM PUBLIC;
REVOKE ALL ON TABLE public.organization_invitations FROM anon;
REVOKE ALL ON TABLE public.organization_invitations FROM authenticated;
