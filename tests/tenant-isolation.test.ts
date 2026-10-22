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
const sql005 = readRepo('supabase/migrations/005_organization_invitations.sql');
const loginSrc = readRepo('src/app/login/page.tsx');
const callbackSrc = readRepo('src/app/auth/callback/route.ts');
const onboardingSrc = readRepo('src/app/onboarding/page.tsx');
const inviteSrc = readRepo('src/app/team/invite/page.tsx');
const acceptSrc = readRepo('src/app/invite/accept/page.tsx');
const orgSrc = readRepo('src/lib/auth/organization.ts');

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

  it('permission matrix: agent cannot manage members; owner and admin can', () => {
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
});

describe('migration 005 invitations (static SQL contract)', () => {
  it('forbids owner role on invitations via check constraint', () => {
    assert.match(sql005, /invitation_role_not_owner CHECK \(role IN \('admin', 'agent'\)\)/);
  });

  it('create_organization_invitation only allows admin and agent roles', () => {
    assert.match(sql005, /p_role NOT IN \('admin', 'agent'\)/);
  });

  it('create invitation requires caller owner or admin', () => {
    assert.match(sql005, /v_caller_role NOT IN \('owner', 'admin'\)/);
  });

  it('create invitation fails closed when zero active memberships', () => {
    assert.match(sql005, /v_active_count = 0/);
    assert.match(sql005, /No active organization membership/);
  });

  it('create invitation fails closed when multiple active memberships (no ORDER BY LIMIT 1)', () => {
    assert.match(sql005, /v_active_count > 1/);
    assert.match(sql005, /Multiple active organization memberships/);
    // Must not pick an arbitrary org
    assert.doesNotMatch(
      sql005,
      /ORDER BY om\.joined_at NULLS LAST, om\.created_at\s*\n\s*LIMIT 1/,
    );
  });

  it('stores token_hash and uses digest', () => {
    assert.match(sql005, /token_hash text NOT NULL/);
    assert.match(sql005, /extensions\.digest\(/);
  });

  it('accept rejects email mismatch', () => {
    assert.match(sql005, /Email does not match invitation/);
  });

  it('accept rejects already accepted and enforces expires_at without UPDATE then RAISE', () => {
    assert.match(sql005, /Invitation already accepted/);
    assert.match(sql005, /expires_at < now\(\)/);
    assert.match(sql005, /Invitation expired/);
    // No rolled-back pattern: SET status = 'expired' immediately before RAISE EXCEPTION 'Invitation expired'
    assert.doesNotMatch(
      sql005,
      /SET status = 'expired'[\s\S]{0,120}RAISE EXCEPTION 'Invitation expired'/,
    );
  });

  it('invite RPCs are SECURITY DEFINER with empty search_path', () => {
    assert.match(
      sql005,
      /create_organization_invitation[\s\S]*?SECURITY DEFINER[\s\S]*?search_path = ''/,
    );
    assert.match(
      sql005,
      /accept_organization_invitation[\s\S]*?SECURITY DEFINER[\s\S]*?search_path = ''/,
    );
  });
});

describe('migration 004 profile trigger (static SQL contract)', () => {
  it('inserts profiles.id from NEW.id only', () => {
    assert.match(sql004, /VALUES\s*\(\s*NEW\.id,/i);
  });

  it('does not contain executable ALTER DEFAULT PRIVILEGES', () => {
    const executable = sql004
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    assert.doesNotMatch(executable, /ALTER\s+DEFAULT\s+PRIVILEGES/i);
  });
});

describe('app invite / membership sources (static)', () => {
  it('invite page calls create_organization_invitation RPC', () => {
    assert.match(inviteSrc, /create_organization_invitation/);
    assert.match(inviteSrc, /p_email/);
    assert.match(inviteSrc, /p_role/);
  });

  it('invite UI states that email is not sent automatically', () => {
    assert.match(inviteSrc, /ایمیل خودکار ارسال نمی‌کند/);
    assert.doesNotMatch(inviteSrc, /لینک ورود به ایمیل شما ارسال شد/);
  });

  it('accept page calls accept_organization_invitation with token', () => {
    assert.match(acceptSrc, /accept_organization_invitation/);
    assert.match(acceptSrc, /p_token/);
  });

  it('getCurrentMembership refuses multiple active orgs', () => {
    assert.match(orgSrc, /multiple active memberships/);
    assert.match(orgSrc, /data\.length > 1/);
  });

  it('login and callback guard next path against open redirect', () => {
    assert.match(loginSrc, /safeNextPath/);
    assert.match(callbackSrc, /safeNextPath/);
    assert.match(callbackSrc, /startsWith\('\/'\)/);
  });

  it('onboarding RPC passes only p_name', () => {
    assert.match(onboardingSrc, /create_organization_with_owner/);
    assert.match(onboardingSrc, /p_name:\s*name\.trim\(\)/);
  });
});
