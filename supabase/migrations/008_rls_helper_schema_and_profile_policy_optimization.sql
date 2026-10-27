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

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon;
GRANT USAGE ON SCHEMA private TO authenticated;

COMMENT ON SCHEMA private IS
  'Internal helpers for RLS. Must not be listed in Data API exposed schemas.';

-- ------------------------------------------------------------
-- 2. Single helper: active organization IDs for current user
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.user_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT om.organization_id
  FROM public.organization_members AS om
  WHERE om.user_id = (SELECT auth.uid())
    AND om.status = 'active';
$$;

REVOKE ALL ON FUNCTION private.user_organization_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.user_organization_ids() FROM anon;
GRANT EXECUTE ON FUNCTION private.user_organization_ids() TO authenticated;

COMMENT ON FUNCTION private.user_organization_ids() IS
  'Active organization IDs for the current user. SECURITY DEFINER; empty search_path. For RLS evaluation only.';

-- ------------------------------------------------------------
-- 3. organizations / organization_members SELECT policies
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their organizations" ON public.organizations;

CREATE POLICY "Users can view their organizations"
  ON public.organizations
  FOR SELECT
  TO authenticated
  USING (
    id IN (SELECT private.user_organization_ids())
  );

DROP POLICY IF EXISTS "Users can view their memberships" ON public.organization_members;
DROP POLICY IF EXISTS "Members can view organization members" ON public.organization_members;

CREATE POLICY "Members can view organization members"
  ON public.organization_members
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (SELECT private.user_organization_ids())
  );

-- ------------------------------------------------------------
-- 4. Business-table tenant policies (only if table + organization_id exist)
--    Preserve policy names and FOR ALL + USING/WITH CHECK behavior.
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients', 'needs', 'follow_ups', 'activities', 'properties']
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = t
        AND column_name = 'organization_id'
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS %L ON public.%I', 'Tenant isolation for ' || t, t);
      EXECUTE format(
        $pol$
          CREATE POLICY %L
            ON public.%I FOR ALL
            TO authenticated
            USING (
              organization_id IN (SELECT private.user_organization_ids())
            )
            WITH CHECK (
              organization_id IN (SELECT private.user_organization_ids())
            )
        $pol$,
        'Tenant isolation for ' || t,
        t
      );
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 5. profiles: one SELECT policy (self + active same-org members);
--    UPDATE keeps USING + WITH CHECK for self only.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view profiles in same organization" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can view accessible profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR id IN (
      SELECT om.user_id
      FROM public.organization_members AS om
      WHERE om.status = 'active'
        AND om.organization_id IN (SELECT private.user_organization_ids())
    )
  );

CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- ------------------------------------------------------------
-- 6. Drop public helper aliases only after policies no longer reference them
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.user_organization_ids();
DROP FUNCTION IF EXISTS public.user_active_organization_ids();

-- ------------------------------------------------------------
-- 7. Intentional invitation lock-down (do not re-grant SELECT / re-add policies)
--    007 already revoked direct access and dropped the member view policy.
--    Re-assert grants remain closed for public client roles.
-- ------------------------------------------------------------
REVOKE ALL ON TABLE public.organization_invitations FROM PUBLIC;
REVOKE ALL ON TABLE public.organization_invitations FROM anon;
REVOKE ALL ON TABLE public.organization_invitations FROM authenticated;

-- ============================================================
-- End of 008_rls_helper_schema_and_profile_policy_optimization.sql
-- ============================================================
