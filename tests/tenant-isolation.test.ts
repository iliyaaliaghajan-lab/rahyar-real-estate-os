/**
 * Unit / static contract tests for multi-tenant design.
 *
 * - Reads real migration SQL and application source files.
 * - Does NOT connect to Supabase.
 * - Passing these tests does NOT prove RLS or database security.
 * - Live RLS scenarios: docs/STAGING_RLS_TEST_PLAN.md (not executed here).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROLES,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  isValidRole,
  type Role,
} from '../src/lib/auth/roles';

const root = process.cwd();

function readRepo(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

const sql001 = readRepo('supabase/migrations/001_initial_multitenant.sql');
const sql003 = readRepo('supabase/migrations/003_secure_org_policies.sql');
const sql004 = readRepo('supabase/migrations/004_default_privs_and_profile.sql');
const loginSrc = readRepo('src/app/login/page.tsx');
const callbackSrc = readRepo('src/app/auth/callback/route.ts');
const onboardingSrc = readRepo('src/app/onboarding/page.tsx');

describe('role module (unit — real TypeScript exports)', () => {
  it('exports owner, admin, agent only', () => {
    assert.deepEqual([...ROLES], ['owner', 'admin', 'agent']);
  });

  it('ROLE_LABELS covers every ROLES entry with non-empty string', () => {
    for (const role of ROLES) {
      assert.equal(typeof ROLE_LABELS[role], 'string');
      assert.ok(ROLE_LABELS[role].length > 0);
    }
  });

  it('permission matrix: only owner canDeleteOrganization', () => {
    assert.equal(ROLE_PERMISSIONS.owner.canDeleteOrganization, true);
    assert.equal(ROLE_PERMISSIONS.admin.canDeleteOrganization, false);
    assert.equal(ROLE_PERMISSIONS.agent.canDeleteOrganization, false);
  });

  it('permission matrix: agent cannot manage members', () => {
    assert.equal(ROLE_PERMISSIONS.agent.canManageMembers, false);
    assert.equal(ROLE_PERMISSIONS.owner.canManageMembers, true);
    assert.equal(ROLE_PERMISSIONS.admin.canManageMembers, true);
  });

  it('isValidRole matches ROLES and rejects unknown values', () => {
    for (const role of ROLES) {
      assert.equal(isValidRole(role), true);
    }
    assert.equal(isValidRole('manager'), false);
    assert.equal(isValidRole(''), false);
    assert.equal(isValidRole('OWNER'), false);
  });

  it('ROLE_PERMISSIONS has boolean flags for every role', () => {
    for (const role of ROLES) {
      const p = ROLE_PERMISSIONS[role as Role];
      assert.equal(typeof p.canManageMembers, 'boolean');
      assert.equal(typeof p.canDeleteOrganization, 'boolean');
      assert.equal(typeof p.canManageOrgSettings, 'boolean');
      assert.equal(typeof p.canManageBusinessData, 'boolean');
    }
  });
});

describe('migration 003 create_organization_with_owner (static SQL contract)', () => {
  it('defines create_organization_with_owner with single text parameter p_name', () => {
    assert.match(sql003, /create_organization_with_owner\s*\(\s*p_name\s+text\s*\)/i);
  });

  it('binds membership user_id to auth.uid() not a client parameter', () => {
    assert.match(sql003, /v_uid\s+uuid\s*:=\s*auth\.uid\(\)/);
    assert.match(sql003, /user_id,\s*\n\s*role,/);
    // Insert uses v_uid for user_id
    assert.match(sql003, /v_org_id,\s*\n\s*v_uid,\s*\n\s*'owner'/);
  });

  it('hard-codes role owner and status active in the function body', () => {
    assert.match(sql003, /'owner'/);
    assert.match(sql003, /'active'/);
    assert.doesNotMatch(sql003, /p_role|p_user_id|p_status/);
  });

  it('is SECURITY DEFINER with empty search_path', () => {
    assert.match(
      sql003,
      /create_organization_with_owner[\s\S]*?security definer[\s\S]*?set search_path\s*=\s*''/i,
    );
  });

  it('revokes execute from public and anon; grants execute to authenticated', () => {
    assert.match(
      sql003,
      /revoke all on function public\.create_organization_with_owner\(text\) from public/i,
    );
    assert.match(
      sql003,
      /revoke all on function public\.create_organization_with_owner\(text\) from anon/i,
    );
    assert.match(
      sql003,
      /grant execute on function public\.create_organization_with_owner\(text\) to authenticated/i,
    );
  });

  it('raises when not authenticated', () => {
    assert.match(sql003, /if v_uid is null then\s*raise exception 'Not authenticated'/i);
  });
});

describe('migration 001 table privilege intent (static SQL contract)', () => {
  it('revokes all on organizations from public, anon, and authenticated before select grant', () => {
    assert.match(sql001, /revoke all on table public\.organizations from public/i);
    assert.match(sql001, /revoke all on table public\.organizations from anon/i);
    assert.match(sql001, /revoke all on table public\.organizations from authenticated/i);
    assert.match(sql001, /grant select on table public\.organizations to authenticated/i);
  });

  it('does not grant insert on organizations or organization_members to authenticated', () => {
    assert.doesNotMatch(
      sql001,
      /grant\s+insert[^;]*on table public\.organizations to authenticated/i,
    );
    assert.doesNotMatch(
      sql001,
      /grant\s+insert[^;]*on table public\.organization_members to authenticated/i,
    );
  });

  it('profiles: grant select, update only to authenticated (no insert grant)', () => {
    assert.match(sql001, /grant select, update on table public\.profiles to authenticated/i);
    assert.doesNotMatch(
      sql001,
      /grant\s+insert[^;]*on table public\.profiles to authenticated/i,
    );
  });
});

describe('migration 004 profile trigger (static SQL contract)', () => {
  it('defines handle_new_user as SECURITY DEFINER with empty search_path', () => {
    assert.match(
      sql004,
      /handle_new_user[\s\S]*?SECURITY DEFINER[\s\S]*?search_path\s*=\s*''/i,
    );
  });

  it('inserts profiles.id from NEW.id only', () => {
    assert.match(sql004, /INSERT INTO public\.profiles\s*\(\s*id,/i);
    assert.match(sql004, /VALUES\s*\(\s*NEW\.id,/i);
  });

  it('uses ON CONFLICT DO NOTHING for existing profiles', () => {
    assert.match(sql004, /ON CONFLICT\s*\(\s*id\s*\)\s*DO NOTHING/i);
  });

  it('revokes execute from PUBLIC, anon, and authenticated', () => {
    assert.match(sql004, /REVOKE ALL ON FUNCTION public\.handle_new_user\(\) FROM PUBLIC/i);
    assert.match(sql004, /REVOKE ALL ON FUNCTION public\.handle_new_user\(\) FROM anon/i);
    assert.match(sql004, /REVOKE ALL ON FUNCTION public\.handle_new_user\(\) FROM authenticated/i);
  });

  it('does not contain executable ALTER DEFAULT PRIVILEGES statements', () => {
    // Guide may mention the phrase in comments; executable lines must not start with ALTER DEFAULT
    const executable = sql004
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    assert.doesNotMatch(executable, /ALTER\s+DEFAULT\s+PRIVILEGES/i);
  });
});

describe('app signup / onboarding sources (static)', () => {
  it('login uses signInWithOtp and does not write to profiles', () => {
    assert.match(loginSrc, /signInWithOtp/);
    assert.doesNotMatch(loginSrc, /from\(['"]profiles['"]\)/);
    assert.doesNotMatch(loginSrc, /\.insert\(/);
  });

  it('auth callback exchanges code for session only', () => {
    assert.match(callbackSrc, /exchangeCodeForSession/);
    assert.doesNotMatch(callbackSrc, /from\(['"]profiles['"]\)/);
  });

  it('onboarding RPC passes only p_name to create_organization_with_owner', () => {
    assert.match(onboardingSrc, /rpc\(\s*['"]create_organization_with_owner['"]/);
    assert.match(onboardingSrc, /p_name:\s*name\.trim\(\)/);
    assert.doesNotMatch(onboardingSrc, /p_user_id|p_role|user_id:\s*|role:\s*['"]owner['"]/);
  });
});

// ---------------------------------------------------------------------------
// Integration / live RLS: NOT runnable without Supabase credentials.
// Plan: docs/STAGING_RLS_TEST_PLAN.md — do not claim security from this file.
// ---------------------------------------------------------------------------
