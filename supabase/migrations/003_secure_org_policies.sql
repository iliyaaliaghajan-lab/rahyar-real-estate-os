-- ============================================================
-- 003_secure_org_policies.sql
-- Secure multi-tenant foundation: org creation + membership RLS
-- ============================================================
-- Scope: organizations + organization_members only.
-- Does NOT modify business-table policies from 001/002.
-- Safe to re-run (DROP POLICY IF EXISTS / CREATE OR REPLACE).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Helper: active organization IDs for current user
--    Used by RLS to avoid recursive policy evaluation.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_active_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT organization_id
  FROM public.organization_members
  WHERE user_id = auth.uid()
    AND status = 'active';
$$;

REVOKE ALL ON FUNCTION public.user_active_organization_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_active_organization_ids() FROM anon;
GRANT EXECUTE ON FUNCTION public.user_active_organization_ids() TO authenticated;

COMMENT ON FUNCTION public.user_active_organization_ids() IS
  'Returns organization IDs where the current user is an active member. SECURITY DEFINER to avoid RLS recursion.';

-- ------------------------------------------------------------
-- 2. Atomic organization creation + owner membership
--    Client only passes name. Identity and role come from auth.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_organization_with_owner(p_name text)
RETURNS TABLE (organization_id uuid, organization_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_org_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) < 2 THEN
    RAISE EXCEPTION 'Invalid organization name';
  END IF;

  v_org_name := trim(p_name);

  INSERT INTO public.organizations (name)
  VALUES (v_org_name)
  RETURNING id, name INTO v_org_id, v_org_name;

  INSERT INTO public.organization_members (
    organization_id,
    user_id,
    role,
    status,
    joined_at
  ) VALUES (
    v_org_id,
    v_uid,
    'owner',
    'active',
    now()
  );

  RETURN QUERY SELECT v_org_id, v_org_name;
END;
$$;

REVOKE ALL ON FUNCTION public.create_organization_with_owner(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_organization_with_owner(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_organization_with_owner(text) TO authenticated;

COMMENT ON FUNCTION public.create_organization_with_owner(text) IS
  'Atomically creates an organization and adds the current user as owner. Role and user_id cannot be supplied by the client.';

-- ------------------------------------------------------------
-- 3. RLS policies for organizations (SELECT only)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their organizations" ON public.organizations;

CREATE POLICY "Users can view their organizations"
  ON public.organizations
  FOR SELECT
  TO authenticated
  USING (
    id IN (SELECT public.user_active_organization_ids())
  );

-- No INSERT / UPDATE / DELETE policies on organizations.
-- Creation goes only through create_organization_with_owner().

-- ------------------------------------------------------------
-- 4. RLS policies for organization_members (SELECT only)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their memberships" ON public.organization_members;
DROP POLICY IF EXISTS "Members can view organization members" ON public.organization_members;

CREATE POLICY "Members can view organization members"
  ON public.organization_members
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (SELECT public.user_active_organization_ids())
  );

-- No INSERT / UPDATE / DELETE policies on organization_members.
-- Membership creation for the founding owner goes only through
-- create_organization_with_owner(). Role changes are out of scope
-- for this migration and remain closed at the RLS layer.

-- ============================================================
-- End of 003_secure_org_policies.sql
-- ============================================================
