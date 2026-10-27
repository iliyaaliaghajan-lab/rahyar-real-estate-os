-- Isolated Postgres stubs for Supabase-style auth + API roles.
-- Used only by verify/migration-008-isolated-postgres workflow.
-- Does NOT touch any live Supabase project.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Allow non-superuser migrators to create FKs to auth.users
GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT SELECT, REFERENCES ON TABLE auth.users TO PUBLIC;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

COMMENT ON FUNCTION auth.uid() IS 'Isolated stub: reads request.jwt.claim.sub GUC';

CREATE OR REPLACE FUNCTION auth.set_test_uid(p_uid uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
END;
$$;

GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
GRANT EXECUTE ON FUNCTION auth.set_test_uid(uuid) TO PUBLIC;
