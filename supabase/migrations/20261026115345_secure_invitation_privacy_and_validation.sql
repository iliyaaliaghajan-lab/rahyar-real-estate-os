-- ============================================================
-- 007_secure_invitation_privacy_and_validation.sql
-- Incremental hardening for organization invitations (after 005).
-- Definition of invitation privacy / create validation. Environment apply status: see docs/INVITATIONS.md and docs/STAGING_RLS_TEST_PLAN.md.
-- ============================================================
-- Goals:
-- 1) Stop authenticated members from reading organization_invitations
--    directly (privacy). Create/accept remain RPC-only paths.
-- 2) Align create_organization_invitation pre-checks with accept rules
--    so we do not issue tokens that accept would reject.
-- ============================================================

-- ------------------------------------------------------------
-- A) Direct table access: no SELECT for PUBLIC / anon / authenticated
-- ------------------------------------------------------------
REVOKE ALL ON TABLE public.organization_invitations FROM PUBLIC;
REVOKE ALL ON TABLE public.organization_invitations FROM anon;
REVOKE ALL ON TABLE public.organization_invitations FROM authenticated;

DROP POLICY IF EXISTS "Members can view org invitations" ON public.organization_invitations;

-- RLS stays enabled (set in 005). service_role is unchanged.
-- No new list-invitations RPC in this migration.

-- ------------------------------------------------------------
-- B) create_organization_invitation — reject non-acceptable targets
-- ------------------------------------------------------------
-- Keep: signature, SECURITY DEFINER, search_path = '', auth.uid(),
-- exactly-one-active-membership for caller, owner/admin only,
-- role admin|agent only, token hash, revoke prior pending, 7-day expiry.
-- EXECUTE remains authenticated-only (re-asserted below).

CREATE OR REPLACE FUNCTION public.create_organization_invitation(
  p_email text,
  p_role public.member_role
)
RETURNS TABLE (
  invitation_id uuid,
  token text,
  expires_at timestamptz,
  invite_email text,
  invite_role public.member_role
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_caller_role public.member_role;
  v_email text;
  v_token text;
  v_hash text;
  v_expires timestamptz;
  v_id uuid;
  v_active_count int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_email := lower(trim(p_email));
  IF v_email IS NULL OR position('@' IN v_email) < 2 OR length(v_email) < 5 THEN
    RAISE EXCEPTION 'Invalid email';
  END IF;

  IF p_role IS NULL OR p_role NOT IN ('admin', 'agent') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  SELECT count(*)::int INTO v_active_count
  FROM public.organization_members om
  WHERE om.user_id = v_uid
    AND om.status = 'active';

  IF v_active_count = 0 THEN
    RAISE EXCEPTION 'No active organization membership';
  END IF;

  IF v_active_count > 1 THEN
    RAISE EXCEPTION 'Multiple active organization memberships';
  END IF;

  SELECT om.organization_id, om.role
    INTO v_org_id, v_caller_role
  FROM public.organization_members om
  WHERE om.user_id = v_uid
    AND om.status = 'active';

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Not authorized to invite';
  END IF;

  -- Any membership row (any status) for this email in the same org → reject
  -- (aligns with accept: "Membership already exists")
  IF EXISTS (
    SELECT 1
    FROM public.organization_members om
    JOIN auth.users u ON u.id = om.user_id
    WHERE om.organization_id = v_org_id
      AND lower(u.email) = v_email
  ) THEN
    RAISE EXCEPTION 'Membership already exists for this email in the organization';
  END IF;

  -- Active membership in another org for this email → reject
  -- (aligns with accept: "User already belongs to another organization")
  IF EXISTS (
    SELECT 1
    FROM public.organization_members om
    JOIN auth.users u ON u.id = om.user_id
    WHERE lower(u.email) = v_email
      AND om.status = 'active'
      AND om.organization_id <> v_org_id
  ) THEN
    RAISE EXCEPTION 'User already belongs to another organization';
  END IF;

  -- If target email is not yet in auth.users, both checks above are false
  -- and invitation for future signup remains allowed.

  UPDATE public.organization_invitations
  SET status = 'revoked',
      updated_at = now()
  WHERE organization_id = v_org_id
    AND lower(email) = v_email
    AND status = 'pending';

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  v_expires := now() + interval '7 days';

  INSERT INTO public.organization_invitations (
    organization_id,
    email,
    role,
    status,
    token_hash,
    invited_by,
    expires_at
  ) VALUES (
    v_org_id,
    v_email,
    p_role,
    'pending',
    v_hash,
    v_uid,
    v_expires
  )
  RETURNING id INTO v_id;

  RETURN QUERY
  SELECT v_id, v_token, v_expires, v_email, p_role;
END;
$$;

REVOKE ALL ON FUNCTION public.create_organization_invitation(text, public.member_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_organization_invitation(text, public.member_role) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_organization_invitation(text, public.member_role) TO authenticated;

COMMENT ON FUNCTION public.create_organization_invitation(text, public.member_role) IS
  'Owner/admin with exactly one active membership creates pending invite; rejects targets with any same-org membership or active other-org membership; raw token once. No owner role.';

-- ============================================================
-- End of 007_secure_invitation_privacy_and_validation.sql
-- ============================================================
