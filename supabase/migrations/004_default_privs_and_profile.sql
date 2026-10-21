-- ============================================================
-- 004_default_privs_and_profile.sql
-- OPTIONAL hardening after 001–003 (review before any apply)
-- ============================================================
-- Prerequisites: 001, 002, 003 applied on an isolated staging project only.
-- DO NOT run on production. DO NOT apply until privileges are reviewed live.
--
-- Default privileges only affect FUTURE objects created by the role named
-- in FOR ROLE. On Supabase, schema owners are often postgres / supabase_admin.
-- Adjust FOR ROLE after confirming with:
--   SELECT defaclrole::regrole, defaclobjtype, defaclacl FROM pg_default_acl;
-- ============================================================

-- ------------------------------------------------------------
-- A) Future tables/sequences: do not auto-grant to client roles
--    (run only if current role matches object creator on staging)
-- ------------------------------------------------------------
-- Example pattern (enable after confirming role names on staging):
--
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--   REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--   REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--   REVOKE ALL ON FUNCTIONS FROM PUBLIC;
--
-- Same blocks may be needed FOR ROLE supabase_admin if that role creates objects.
-- After creating any new business table, grant explicitly, e.g.:
--   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.<name> TO authenticated;
--   REVOKE ALL ON TABLE public.<name> FROM anon, PUBLIC;
--   ALTER TABLE public.<name> ENABLE ROW LEVEL SECURITY;
--   + tenant isolation policy using public.user_organization_ids()

-- ------------------------------------------------------------
-- B) Profile row after signup (SECURITY DEFINER trigger)
--    Inserts only NEW.id from auth.users — client cannot pick another user id.
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
-- No GRANT EXECUTE to client roles: trigger is invoked by the engine on auth.users INSERT.

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- profiles: keep client from inserting arbitrary ids; trigger owns insert
-- (001 already: GRANT SELECT, UPDATE only to authenticated + RLS own row)

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates public.profiles row for new auth.users. id is always NEW.id from Auth.';

-- ============================================================
-- End of 004_default_privs_and_profile.sql
-- ============================================================
