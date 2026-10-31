-- ============================================================
-- 006_invite_fk_indexes_and_single_org_create.sql
-- Staging follow-up: FK covering indexes + single-active-org on create
-- ============================================================
-- Prerequisites: 001–005 applied on target database.
-- Does NOT change invitation token/email/role security rules.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Covering indexes for invitation FKs (Performance Advisor)
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_org_invitations_invited_by
  ON public.organization_invitations (invited_by);

CREATE INDEX IF NOT EXISTS idx_org_invitations_accepted_by
  ON public.organization_invitations (accepted_by);

-- ------------------------------------------------------------
-- 2. create_organization_with_owner: fail closed if already active member
--    Partial unique index still enforces at DB level; explicit check gives
--    a clear error and avoids relying on opaque unique violations alone.
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
  v_active_count int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) < 2 THEN
    RAISE EXCEPTION 'Invalid organization name';
  END IF;

  SELECT count(*)::int INTO v_active_count
  FROM public.organization_members om
  WHERE om.user_id = v_uid
    AND om.status = 'active';

  IF v_active_count > 0 THEN
    RAISE EXCEPTION 'User already has an active organization membership';
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
  'Creates org + owner membership. Rejects if caller already has an active membership.';

-- ============================================================
-- End of 006_invite_fk_indexes_and_single_org_create.sql
-- ============================================================
