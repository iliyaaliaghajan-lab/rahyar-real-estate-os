-- Migration 011: Role-based business-record DELETE authorization
-- Policy (product Option 1):
--   owner / admin: may DELETE business rows in their own active organization
--   agent: must not DELETE any business row (regardless of creator)
-- Scope: properties, clients, needs, follow_ups only.
-- activities remain append-only (SELECT + INSERT only; no DELETE/UPDATE policies).
-- SELECT / INSERT / UPDATE policies and table grants are intentionally unchanged.
-- This migration is Git-only until a separate Staging approval; do not apply hosted DDL from this change set.

-- ---------------------------------------------------------------------------
-- private.user_can_delete_business_data(p_organization_id uuid)
-- Internal RLS helper. Must remain in the unexposed private schema.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.user_can_delete_business_data(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members AS om
    WHERE om.organization_id = p_organization_id
      AND om.user_id = (SELECT auth.uid())
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin')
  );
$$;

REVOKE ALL ON FUNCTION private.user_can_delete_business_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.user_can_delete_business_data(uuid) FROM anon;
REVOKE ALL ON FUNCTION private.user_can_delete_business_data(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION private.user_can_delete_business_data(uuid) TO authenticated;

COMMENT ON FUNCTION private.user_can_delete_business_data(uuid) IS
  'Internal RLS authorization helper: true when the current user has an active owner/admin membership in the given organization. SECURITY DEFINER with empty search_path. Must remain in the unexposed private schema; never trust client-supplied role or user_metadata.';

-- Ownership / privilege preflight (aligned with Migration 008 model)
DO $function_owner_preflight$
DECLARE
  v_server_version_num integer := current_setting('server_version_num')::integer;
  v_function_owner_oid oid;
  v_api_role_name text;
  v_api_role_oid oid;
BEGIN
  SELECT p.proowner INTO v_function_owner_oid
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = pg_catalog.to_regprocedure('private.user_can_delete_business_data(uuid)')::oid;

  IF v_function_owner_oid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42883',
      MESSAGE = 'SECURITY PREFLIGHT FAILED: private.user_can_delete_business_data(uuid) was not found after creation.';
  END IF;

  FOR v_api_role_name, v_api_role_oid IN
    SELECT r.rolname, r.oid FROM pg_catalog.pg_roles AS r WHERE r.rolname IN ('anon', 'authenticated')
  LOOP
    IF v_api_role_oid = v_function_owner_oid
       OR pg_catalog.pg_has_role(v_api_role_oid, v_function_owner_oid, 'USAGE') THEN
      RAISE EXCEPTION USING ERRCODE = '42501',
        MESSAGE = pg_catalog.format(
          'SECURITY PREFLIGHT FAILED: API role "%s" is the owner or can inherit privileges of function owner "%s" for private.user_can_delete_business_data(uuid).',
          v_api_role_name,
          (SELECT r.rolname FROM pg_catalog.pg_roles AS r WHERE r.oid = v_function_owner_oid)
        );
    END IF;

    IF v_server_version_num >= 160000 THEN
      IF pg_catalog.pg_has_role(v_api_role_oid, v_function_owner_oid, 'SET') THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
          MESSAGE = pg_catalog.format(
            'SECURITY PREFLIGHT FAILED: API role "%s" can SET ROLE to function owner "%s" for private.user_can_delete_business_data(uuid).',
            v_api_role_name,
            (SELECT r.rolname FROM pg_catalog.pg_roles AS r WHERE r.oid = v_function_owner_oid)
          );
      END IF;
    ELSE
      IF pg_catalog.pg_has_role(v_api_role_oid, v_function_owner_oid, 'MEMBER') THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
          MESSAGE = pg_catalog.format(
            'SECURITY PREFLIGHT FAILED: API role "%s" can become function owner "%s" through role membership.',
            v_api_role_name,
            (SELECT r.rolname FROM pg_catalog.pg_roles AS r WHERE r.oid = v_function_owner_oid)
          );
      END IF;
    END IF;
  END LOOP;
END;
$function_owner_preflight$;

-- ---------------------------------------------------------------------------
-- Replace permissive member DELETE policies with:
--   1) permissive tenant-scope DELETE (active org membership)
--   2) restrictive role-guard DELETE (owner/admin only via private helper)
-- SELECT / INSERT / UPDATE policies are not touched.
-- ---------------------------------------------------------------------------

-- properties
DROP POLICY IF EXISTS "Tenant isolation for properties" ON public.properties;
DROP POLICY IF EXISTS "properties_delete_member" ON public.properties;
CREATE POLICY "properties_delete_member" ON public.properties
  FOR DELETE TO authenticated
  USING (organization_id IN (SELECT private.user_organization_ids()));
CREATE POLICY "properties_delete_role_guard" ON public.properties
  AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (private.user_can_delete_business_data(organization_id));

-- clients
DROP POLICY IF EXISTS "Tenant isolation for clients" ON public.clients;
DROP POLICY IF EXISTS "clients_delete_member" ON public.clients;
CREATE POLICY "clients_delete_member" ON public.clients
  FOR DELETE TO authenticated
  USING (organization_id IN (SELECT private.user_organization_ids()));
CREATE POLICY "clients_delete_role_guard" ON public.clients
  AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (private.user_can_delete_business_data(organization_id));

-- needs
DROP POLICY IF EXISTS "Tenant isolation for needs" ON public.needs;
DROP POLICY IF EXISTS "needs_delete_member" ON public.needs;
CREATE POLICY "needs_delete_member" ON public.needs
  FOR DELETE TO authenticated
  USING (organization_id IN (SELECT private.user_organization_ids()));
CREATE POLICY "needs_delete_role_guard" ON public.needs
  AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (private.user_can_delete_business_data(organization_id));

-- follow_ups
DROP POLICY IF EXISTS "Tenant isolation for follow_ups" ON public.follow_ups;
DROP POLICY IF EXISTS "follow_ups_delete_member" ON public.follow_ups;
CREATE POLICY "follow_ups_delete_member" ON public.follow_ups
  FOR DELETE TO authenticated
  USING (organization_id IN (SELECT private.user_organization_ids()));
CREATE POLICY "follow_ups_delete_role_guard" ON public.follow_ups
  AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (private.user_can_delete_business_data(organization_id));

-- activities: intentionally no DELETE policy; table grants remain SELECT + INSERT only.
