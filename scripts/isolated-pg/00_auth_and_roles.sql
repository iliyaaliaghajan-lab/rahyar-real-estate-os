-- Isolated Postgres fixtures for the Migration 008 verification harness only.
-- Never run this against Supabase, Staging, or Production.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Minimal pre-existing business tables ensure migration 001/002 and migration
-- 008's dynamic tenant-policy DDL are executed, rather than silently skipped.
CREATE TABLE IF NOT EXISTS public.properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid
);
CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid
);
CREATE TABLE IF NOT EXISTS public.needs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid
);
CREATE TABLE IF NOT EXISTS public.follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid
);
CREATE TABLE IF NOT EXISTS public.activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid
);

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  -- Required by public.handle_new_user() from migration 004.
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Non-superuser migration-role fixtures must be able to create the auth FK
-- and trigger used in this isolated harness. This is test-only, not a live grant.
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
