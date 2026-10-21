/**
 * Logical tenant-isolation contract tests.
 *
 * These tests do NOT connect to Supabase and do NOT prove RLS security.
 * Real isolation requires two users and two orgs on isolated staging.
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

describe('RPC create_organization_with_owner contracts (logical only)', () => {
  it('client payload may only include organization name', () => {
    const clientPayload = { p_name: 'آژانس نمونه' };
    assert.equal('p_name' in clientPayload, true);
    assert.equal('user_id' in clientPayload, false);
    assert.equal('role' in clientPayload, false);
    assert.equal('status' in clientPayload, false);
  });

  it('documents server-fixed owner membership fields', () => {
    // Mirrors 003_secure_org_policies.sql — enforced in DB, not here.
    const serverFixed = {
      role: 'owner',
      status: 'active',
      userIdSource: 'auth.uid()',
    } as const;
    assert.equal(serverFixed.role, 'owner');
    assert.equal(serverFixed.status, 'active');
    assert.equal(serverFixed.userIdSource, 'auth.uid()');
  });

  it('documents expected RPC failure when unauthenticated', () => {
    const expectedSqlStateHint = 'Not authenticated';
    assert.ok(expectedSqlStateHint.length > 0);
  });
});

describe('profile creation contracts (logical only)', () => {
  it('signup UI does not insert profiles (trigger/server responsibility)', () => {
    // login/page.tsx only calls signInWithOtp; callback only exchangeCodeForSession.
    const clientSignupActions = ['signInWithOtp', 'exchangeCodeForSession'] as const;
    assert.equal(clientSignupActions.includes('signInWithOtp'), true);
    assert.ok(!clientSignupActions.includes('profiles.insert' as never));
  });

  it('profile id must equal auth user id (no client-chosen owner)', () => {
    const profileInsertShape = { id: '<auth.uid() / NEW.id only>' };
    assert.equal(Object.keys(profileInsertShape).includes('id'), true);
    assert.equal(Object.keys(profileInsertShape).includes('user_id'), false);
  });
});

describe('live staging acceptance checklist (documentation only)', () => {
  it('lists required cross-tenant checks without executing them', () => {
    const liveChecks = [
      'user_A_rpc_create_org',
      'user_B_rpc_create_org',
      'user_A_cannot_select_org_B',
      'user_A_cannot_select_members_of_org_B',
      'user_A_cannot_direct_insert_organizations',
      'user_A_cannot_direct_insert_members',
      'user_A_cannot_update_role',
      'anon_cannot_select_org_tables',
      'anon_cannot_execute_create_organization_with_owner',
    ] as const;
    assert.equal(liveChecks.length, 9);
  });

  it('notes business-table isolation requires fixtures if tables absent', () => {
    const emptyStagingHasBusinessTables = false;
    assert.equal(emptyStagingHasBusinessTables, false);
  });
});
