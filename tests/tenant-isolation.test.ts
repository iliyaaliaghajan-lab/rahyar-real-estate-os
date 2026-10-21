/**
 * Logical tenant-isolation contract tests.
 *
 * Scope: in-code role definitions and contracts only.
 * These tests do NOT connect to Supabase and do NOT prove RLS security.
 * Real isolation must be verified later with two users and two orgs
 * on a test Supabase project.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLES,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  isValidRole,
  type Role,
} from '../src/lib/auth/roles';

describe('role contracts (logical only)', () => {
  it('defines exactly owner, admin, agent', () => {
    assert.deepEqual([...ROLES], ['owner', 'admin', 'agent']);
  });

  it('has Persian labels for every role', () => {
    for (const role of ROLES) {
      assert.equal(typeof ROLE_LABELS[role], 'string');
      assert.ok(ROLE_LABELS[role].length > 0);
    }
  });

  it('owner is the only role that can delete the organization', () => {
    assert.equal(ROLE_PERMISSIONS.owner.canDeleteOrganization, true);
    assert.equal(ROLE_PERMISSIONS.admin.canDeleteOrganization, false);
    assert.equal(ROLE_PERMISSIONS.agent.canDeleteOrganization, false);
  });

  it('agent cannot manage members', () => {
    assert.equal(ROLE_PERMISSIONS.agent.canManageMembers, false);
    assert.equal(ROLE_PERMISSIONS.owner.canManageMembers, true);
    assert.equal(ROLE_PERMISSIONS.admin.canManageMembers, true);
  });

  it('isValidRole accepts only known roles', () => {
    assert.equal(isValidRole('owner'), true);
    assert.equal(isValidRole('admin'), true);
    assert.equal(isValidRole('agent'), true);
    assert.equal(isValidRole('manager'), false);
    assert.equal(isValidRole(''), false);
    assert.equal(isValidRole('OWNER'), false);
  });

  it('permission matrix covers every role key', () => {
    for (const role of ROLES) {
      const perms = ROLE_PERMISSIONS[role as Role];
      assert.equal(typeof perms.canManageMembers, 'boolean');
      assert.equal(typeof perms.canDeleteOrganization, 'boolean');
      assert.equal(typeof perms.canManageOrgSettings, 'boolean');
      assert.equal(typeof perms.canManageBusinessData, 'boolean');
    }
  });
});

describe('RPC contract notes (documentation assertions)', () => {
  it('create_organization_with_owner accepts only organization name from client', () => {
    // Contract: client must not send user_id or role.
    // Enforced in the database function, not in this test environment.
    const clientPayload = { p_name: 'آژانس نمونه' };
    assert.equal('p_name' in clientPayload, true);
    assert.equal('user_id' in clientPayload, false);
    assert.equal('role' in clientPayload, false);
  });
});
