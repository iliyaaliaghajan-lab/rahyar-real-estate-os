/**
 * Static SQL contract tests for migration 008 only.
 * Does NOT connect to Supabase. Passing does NOT prove live RLS.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '008_rls_helper_schema_and_profile_policy_optimization.sql'
);
const sql = readFileSync(migrationPath, 'utf8');

describe('migration 008 static contracts', () => {
  it('creates private schema',
    () => assert.match(sql, /CREATE SCHEMA IF NOT EXISTS private/i));

  it('defines private.user_organization_ids as SECURITY DEFINER',
    () => {
      assert.match(sql, /CREATE OR REPLACE FUNCTION private\.user_organization_ids\(\)/i);
      assert.match(sql, /SECURITY DEFINER/i);
    });

  it('sets empty search_path on the helper',
    () => assert.match(sql, /SET search_path\s*=\s*''/i));

  it('grants USAGE on private only to authenticated',
    () => {
      assert.match(sql, /GRANT USAGE ON SCHEMA private TO authenticated/i);
      assert.match(sql, /REVOKE ALL ON SCHEMA private FROM (PUBLIC|anon)/i);
    });

  it('uses %I for dynamic policy identifiers (not %L)',
    () => {
      assert.match(sql, /format\(\s*'DROP POLICY IF EXISTS %I/i);
      assert.match(sql, /CREATE POLICY %I/i);
      assert.doesNotMatch(sql, /format\(\s*'DROP POLICY IF EXISTS %L/i);
    });

  it('includes SECURITY PREFLIGHT FAILED markers',
    () => {
      assert.match(sql, /SECURITY PREFLIGHT FAILED/i);
      const count = (sql.match(/SECURITY PREFLIGHT FAILED/g) || []).length;
      assert.ok(count >= 5, `expected >=5 preflight messages, got ${count}`);
    });

  it('checks schema owner and function owner independently',
    () => {
      assert.match(sql, /schema private/i);
      assert.match(sql, /function private\.user_organization_ids\(\)/i);
      assert.match(sql, /pg_has_role/i);
    });

  it('checks USAGE and SET/MEMBER role paths by PG version',
    () => {
      assert.match(sql, /pg_has_role\([^,]+,[^,]+,\s*'USAGE'\)/i);
      assert.match(sql, /server_version_num\s*>=\s*160000/i);
      assert.match(sql, /pg_has_role\([^,]+,[^,]+,\s*'SET'\)/i);
      assert.match(sql, /pg_has_role\([^,]+,[^,]+,\s*'MEMBER'\)/i);
    });

  it('checks effective CREATE on private for API roles',
    () => {
      assert.match(sql, /has_schema_privilege\([^,]+,\s*'private',\s*'CREATE'\)/i);
      assert.match(sql, /still has effective CREATE on schema private/i);
    });

  it('drops public helper functions',
    () => {
      assert.match(sql, /DROP FUNCTION IF EXISTS public\.user_organization_ids\(\)/i);
      assert.match(sql, /DROP FUNCTION IF EXISTS public\.user_active_organization_ids\(\)/i);
    });

  it('locks down organization_invitations SELECT for API roles',
    () => {
      assert.match(sql, /REVOKE SELECT ON public\.organization_invitations FROM authenticated/i);
      assert.match(sql, /REVOKE SELECT ON public\.organization_invitations FROM anon/i);
    });
});
