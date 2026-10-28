/**
 * Static SQL contract tests for migration 008 only.
 * Does NOT connect to Supabase. Passing does NOT prove live RLS.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const migrationPath = join(
  root,
  'supabase',
  'migrations',
  '008_rls_helper_schema_and_profile_policy_optimization.sql'
);
const harnessPath = join(root, 'scripts', 'isolated-pg', 'run_matrix.sh');
const workflowPath = join(
  root,
  '.github',
  'workflows',
  'verify-migration-008-isolated-postgres.yml'
);
const readOnlyPreflightPath = join(
  root,
  'docs',
  'MIGRATION_008_READ_ONLY_PREFLIGHT.sql'
);

const sql = readFileSync(migrationPath, 'utf8');
const harness = readFileSync(harnessPath, 'utf8');
const workflow = readFileSync(workflowPath, 'utf8');

describe('migration 008 static contracts', () => {
  it('creates private schema', () =>
    assert.match(sql, /CREATE SCHEMA IF NOT EXISTS private/i));

  it('defines private.user_organization_ids as SECURITY DEFINER', () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION private\.user_organization_ids\(\)/i);
    assert.match(sql, /SECURITY DEFINER/i);
  });

  it('sets empty search_path on the helper', () =>
    assert.match(sql, /SET search_path\s*=\s*''/i));

  it('grants USAGE on private only to authenticated', () => {
    assert.match(sql, /GRANT USAGE ON SCHEMA private TO authenticated/i);
    assert.match(sql, /REVOKE ALL ON SCHEMA private FROM (PUBLIC|anon)/i);
  });

  it('uses %I for dynamic policy identifiers (not %L)', () => {
    assert.match(sql, /format\(\s*'DROP POLICY IF EXISTS %I/i);
    assert.match(sql, /CREATE POLICY %I/i);
    assert.doesNotMatch(sql, /format\(\s*'DROP POLICY IF EXISTS %L/i);
  });

  it('includes SECURITY PREFLIGHT FAILED markers', () => {
    assert.match(sql, /SECURITY PREFLIGHT FAILED/i);
    const count = (sql.match(/SECURITY PREFLIGHT FAILED/g) || []).length;
    assert.ok(count >= 5, `expected >=5 preflight messages, got ${count}`);
  });

  it('checks schema owner and function owner independently', () => {
    assert.match(sql, /schema private/i);
    assert.match(sql, /function private\.user_organization_ids\(\)/i);
    assert.match(sql, /pg_has_role/i);
  });

  it('checks USAGE and SET/MEMBER role paths by PG version', () => {
    assert.match(sql, /pg_has_role\([^,]+,[^,]+,\s*'USAGE'\)/i);
    assert.match(sql, /server_version_num\s*>=\s*160000/i);
    assert.match(sql, /pg_has_role\([^,]+,[^,]+,\s*'SET'\)/i);
    assert.match(sql, /pg_has_role\([^,]+,[^,]+,\s*'MEMBER'\)/i);
  });

  it('checks effective CREATE on private for API roles', () => {
    assert.match(sql, /has_schema_privilege\([^,]+,\s*'private',\s*'CREATE'\)/i);
    assert.match(sql, /still has effective CREATE on schema private/i);
  });

  it('drops public helper functions', () => {
    assert.match(sql, /DROP FUNCTION IF EXISTS public\.user_organization_ids\(\)/i);
    assert.match(sql, /DROP FUNCTION IF EXISTS public\.user_active_organization_ids\(\)/i);
  });

  it('locks down organization_invitations for API roles', () => {
    assert.match(
      sql,
      /REVOKE (ALL|SELECT) ON (TABLE )?public\.organization_invitations FROM authenticated/i
    );
    assert.match(
      sql,
      /REVOKE (ALL|SELECT) ON (TABLE )?public\.organization_invitations FROM anon/i
    );
  });

  it('preflight C uses function-owner privilege wording', () => {
    assert.match(sql, /privileges of function owner/i);
    assert.match(sql, /SECURITY PREFLIGHT C|-- SECURITY PREFLIGHT C/i);
  });
});

describe('isolated harness and workflow contracts', () => {
  it('harness defines neg_function_owner_preflight_c scenario', () => {
    assert.match(harness, /neg_function_owner_preflight_c\)/);
    assert.match(harness, /M008_TEST_C_FIXTURE/);
    assert.match(harness, /privileges of function owner/);
    assert.match(harness, /fn_owner_c/);
    assert.match(harness, /ddl_command_end|EVENT TRIGGER/i);
  });

  it('expect_preflight_fail requires fixture marker for C scenario', () => {
    assert.match(harness, /required_marker/);
    assert.match(harness, /required fixture marker/);
  });

  it('workflow matrix includes tenant_isolation and preflight C', () => {
    assert.match(workflow, /neg_function_owner_preflight_c/);
    assert.match(workflow, /tenant_isolation/);
    assert.match(harness, /tenant_isolation\)/);
    assert.match(workflow, /pg:\s*\[\s*"15"\s*,\s*"16"\s*,\s*"17"\s*\]/);
  });

  it('workflow runs static contracts job and gates summary', () => {
    assert.match(workflow, /npm ci --no-audit --no-fund/);
    assert.match(workflow, /npm test/);
    assert.match(workflow, /needs:\s*\[matrix,\s*contracts\]/);
    assert.match(workflow, /MATRIX_RESULT/);
    assert.match(workflow, /CONTRACTS_RESULT/);
  });
});

describe('read-only live preflight inventory file', () => {
  it('exists under docs/', () => {
    assert.ok(
      existsSync(readOnlyPreflightPath),
      `missing ${readOnlyPreflightPath}`
    );
  });

  it('is a read-only transaction that ends with ROLLBACK', () => {
    const body = readFileSync(readOnlyPreflightPath, 'utf8');
    assert.match(body, /BEGIN\s+TRANSACTION\s+READ\s+ONLY/i);
    assert.match(body, /ROLLBACK\s*;/);
  });

  it('contains no top-level mutating SQL statements', () => {
    const body = readFileSync(readOnlyPreflightPath, 'utf8');
    // Strip line comments and block comments before scanning statements.
    const stripped = body
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/--[^\n]*/g, ' ');
    const mutating =
      /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|CALL|DO)\b/im;
    assert.doesNotMatch(
      stripped,
      mutating,
      'read-only preflight must not contain top-level mutating statements'
    );
  });
});
