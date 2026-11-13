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

const sql001 = readRepo('supabase/migrations/20261022230848_initial_multitenant.sql');
const sql003 = readRepo('supabase/migrations/20261022230904_secure_org_policies.sql');
const sql004 = readRepo('supabase/migrations/20261022230911_default_privs_and_profile.sql');
const sql005 = readRepo('supabase/migrations/20261022230925_organization_invitations.sql');
const sql006 = readRepo('supabase/migrations/20261027003152_invite_fk_indexes_and_single_org_create.sql');
const sql007 = readRepo('supabase/migrations/20261026115345_secure_invitation_privacy_and_validation.sql');
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
      assert.equal(typeof p.canDeleteBusinessData, 'boolean');
    }
  });

  it('permission matrix: owner and admin canDeleteBusinessData; agent cannot', () => {
    assert.equal(ROLE_PERMISSIONS.owner.canDeleteBusinessData, true);
    assert.equal(ROLE_PERMISSIONS.admin.canDeleteBusinessData, true);
    assert.equal(ROLE_PERMISSIONS.agent.canDeleteBusinessData, false);
  });

  it('canManageBusinessData remains true for all roles (SELECT/INSERT/UPDATE retained)', () => {
    assert.equal(ROLE_PERMISSIONS.owner.canManageBusinessData, true);
    assert.equal(ROLE_PERMISSIONS.admin.canManageBusinessData, true);
    assert.equal(ROLE_PERMISSIONS.agent.canManageBusinessData, true);
  });
});
