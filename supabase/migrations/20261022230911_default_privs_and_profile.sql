-- ============================================================
-- 004_default_privs_and_profile.sql
-- Profile bootstrap after auth.users insert (executable section only)
-- ============================================================
-- Prerequisites: 001 applied (public.profiles exists).
-- Optional after 001–003 on isolated staging only. NOT for production without review.
--
-- IMPORTANT — default privileges are NOT modified by this file.
-- ALTER DEFAULT PRIVILEGES needs live knowledge of which roles create objects
-- (see pg_default_acl). Guidance lives in docs/DEFAULT_PRIVILEGES_GUIDE.md.
-- Applying guessed FOR ROLE values would be unsafe.
-- ============================================================

-- ------------------------------------------------------------
-- handle_new_user: create profiles row for new Auth user
-- ------------------------------------------------------------
-- Design notes (static review):
-- * SECURITY DEFINER + search_path = '' limits search_path hijack risk.
-- * Inserts only NEW.id — client cannot choose another user's id.
-- * full_name / avatar_url are nullable in 001; COALESCE may yield NULL — OK.
-- * ON CONFLICT DO NOTHING: re-run / existing profile does not fail Auth insert.
-- * No EXECUTE for anon/authenticated/PUBLIC: clients must not call this RPC.
--   Triggers run as the function owner via the engine, not via client EXECUTE.
-- * Function owner must be allowed to INSERT into public.profiles (usually the
--   migration role). That ownership/privilege is only verifiable on live DB.
-- * If this function raises, Auth user insert fails — keep body minimal and
--   conflict-safe. Do not add strict NOT NULL on full_name here.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM authenticated;
-- Intentionally no GRANT EXECUTE to client roles.

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

COMMENT ON FUNCTION public.handle_new_user() IS
  'After auth.users insert: upsert profiles row with id = NEW.id only. Not client-callable.';

-- ============================================================
-- End of 004 (executable). Default privileges: see docs/DEFAULT_PRIVILEGES_GUIDE.md
-- ============================================================
