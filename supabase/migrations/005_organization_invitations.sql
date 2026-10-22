-- ============================================================
-- 005_organization_invitations.sql
-- Persisted, time-limited, single-use invitations (manual share link)
-- ============================================================
-- Prerequisites: 001–003 applied. Optional 004 for profiles on signup.
-- Token hashing uses extensions.digest / gen_random_bytes (Supabase pgcrypto).
-- Does NOT send email. Does NOT grant owner via invite.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Invitation status enum
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.invitation_status AS ENUM (
    'pending',
    'accepted',
    'revoked',
    'expired'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ------------------------------------------------------------
-- 2. organization_invitations
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organization_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.member_role NOT NULL,
  status public.invitation_status NOT NULL DEFAULT 'pending',
  token_hash text NOT NULL,
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitation_role_not_owner CHECK (role IN ('admin', 'agent')),
  CONSTRAINT invitation_email_nonempty CHECK (length(trim(email)) > 3)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_invitations_token_hash
  ON public.organization_invitations(token_hash);

CREATE INDEX IF NOT EXISTS idx_org_invitations_org_email
  ON public.organization_invitations(organization_id, lower(email));

CREATE INDEX IF NOT EXISTS idx_org_invitations_status_expires
  ON public.organization_invitations(status, expires_at);

COMMENT ON TABLE public.organization_invitations IS
  'Pending org invites; store only token_hash. Raw token returned once from RPC.';

ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.organization_invitations FROM PUBLIC;
REVOKE ALL ON TABLE public.organization_invitations FROM anon;
REVOKE ALL ON TABLE public.organization_invitations FROM authenticated;
-- Clients manage invites only via SECURITY DEFINER RPCs.
GRANT SELECT ON TABLE public.organization_invitations TO authenticated;

DROP POLICY IF EXISTS "Members can view org invitations" ON public.organization_invitations;
CREATE POLICY "Members can view org invitations"
  ON public.organization_invitations
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (SELECT public.user_active_organization_ids())
  );

-- ------------------------------------------------------------
-- 3. Same-org profile visibility (team roster names)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view profiles in same organization" ON public.profiles;
CREATE POLICY "Users can view profiles in same organization"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR id IN (
      SELECT om.user_id
      FROM public.organization_members om
      WHERE om.status = 'active'
        AND om.organization_id IN (SELECT public.user_active_organization_ids())
    )
  );

-- ------------------------------------------------------------
-- 4. create_organization_invitation(email, role)
-- ------------------------------------------------------------
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

  SELECT om.organization_id, om.role
    INTO v_org_id, v_caller_role
  FROM public.organization_members om
  WHERE om.user_id = v_uid
    AND om.status = 'active'
  ORDER BY om.joined_at NULLS LAST, om.created_at
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No active organization membership';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Not authorized to invite';
  END IF;

  -- Already an active member with this email?
  IF EXISTS (
    SELECT 1
    FROM public.organization_members om
    JOIN auth.users u ON u.id = om.user_id
    WHERE om.organization_id = v_org_id
      AND om.status = 'active'
      AND lower(u.email) = v_email
  ) THEN
    RAISE EXCEPTION 'User already a member';
  END IF;

  -- Revoke prior pending invites for same org+email
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
  'Owner/admin creates pending invite; returns raw token once. Role cannot be owner.';

-- ------------------------------------------------------------
-- 5. accept_organization_invitation(token)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_organization_invitation(p_token text)
RETURNS TABLE (
  organization_id uuid,
  organization_name text,
  member_role public.member_role
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_hash text;
  v_inv public.organization_invitations%ROWTYPE;
  v_org_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_token IS NULL OR length(trim(p_token)) < 32 THEN
    RAISE EXCEPTION 'Invalid token';
  END IF;

  SELECT lower(u.email) INTO v_email
  FROM auth.users u
  WHERE u.id = v_uid;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'User email not available';
  END IF;

  v_hash := encode(extensions.digest(trim(p_token), 'sha256'), 'hex');

  SELECT * INTO v_inv
  FROM public.organization_invitations inv
  WHERE inv.token_hash = v_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found';
  END IF;

  IF v_inv.status = 'accepted' THEN
    RAISE EXCEPTION 'Invitation already accepted';
  END IF;

  IF v_inv.status = 'revoked' THEN
    RAISE EXCEPTION 'Invitation revoked';
  END IF;

  IF v_inv.status <> 'pending' OR v_inv.expires_at < now() THEN
    UPDATE public.organization_invitations
    SET status = 'expired', updated_at = now()
    WHERE id = v_inv.id AND status = 'pending';
    RAISE EXCEPTION 'Invitation expired';
  END IF;

  IF lower(v_inv.email) <> v_email THEN
    RAISE EXCEPTION 'Email does not match invitation';
  END IF;

  IF v_inv.role NOT IN ('admin', 'agent') THEN
    RAISE EXCEPTION 'Invalid invitation role';
  END IF;

  -- Single active org limitation for phase 1
  IF EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = v_uid AND om.status = 'active'
      AND om.organization_id <> v_inv.organization_id
  ) THEN
    RAISE EXCEPTION 'User already belongs to another organization';
  END IF;

  INSERT INTO public.organization_members (
    organization_id,
    user_id,
    role,
    status,
    joined_at
  ) VALUES (
    v_inv.organization_id,
    v_uid,
    v_inv.role,
    'active',
    now()
  )
  ON CONFLICT (organization_id, user_id) DO UPDATE
  SET role = EXCLUDED.role,
      status = 'active',
      joined_at = COALESCE(public.organization_members.joined_at, now()),
      updated_at = now();

  UPDATE public.organization_invitations
  SET status = 'accepted',
      accepted_at = now(),
      accepted_by = v_uid,
      updated_at = now()
  WHERE id = v_inv.id;

  SELECT o.name INTO v_org_name
  FROM public.organizations o
  WHERE o.id = v_inv.organization_id;

  RETURN QUERY
  SELECT v_inv.organization_id, v_org_name, v_inv.role;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_organization_invitation(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_organization_invitation(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_organization_invitation(text) TO authenticated;

COMMENT ON FUNCTION public.accept_organization_invitation(text) IS
  'Accept pending invite by raw token; email must match auth user; one-time.';

-- ============================================================
-- End of 005_organization_invitations.sql
-- ============================================================
