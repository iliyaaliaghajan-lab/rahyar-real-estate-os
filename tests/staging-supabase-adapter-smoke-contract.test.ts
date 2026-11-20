/**
 * Static contract checks for the Staging Supabase adapter smoke runner.
 * No network. Ensures the runner and workflow stay opt-in and pinned.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  classifyListRead,
  classifyMaybeSingleRead,
  extractOrganizationIdFromRpc,
  shouldSkipDisposableUserDelete,
  classifyMembershipListRows,
  ownersWithZeroMembershipRows,
  resolveUnresolvedOwnersAfterDiscovery,
} from '../scripts/staging-supabase-adapter-smoke-gate';
import {
  accumulateBusinessTableResiduals,
  cleanupStatusFromFailures,
  deleteDisposableUsersWithOwnerGate,
  discoverDisposableUserIds,
  discoverOrganizationIds,
  runnerShouldExitNonZero,
  type BusinessCleanupTable,
} from '../scripts/staging-supabase-adapter-smoke-lib';

const root = process.cwd();

describe('staging supabase adapter smoke contract', () => {
  it('runner pins Staging origin and refuses Production ref', () => {
    const src = readFileSync(join(root, 'scripts/staging-supabase-adapter-smoke-lib.ts'), 'utf8') + readFileSync(join(root, 'scripts/staging-supabase-adapter-smoke.ts'), 'utf8');
    assert.match(src, /dezonafotwyvvghbccko\.supabase\.co/);
    assert.match(src, /gguvmewknanhzukugvpj/);
    assert.match(src, /STAGING_MIGRATION_011_CONFIRMED/);
    assert.match(src, /createSupabaseRepositories/);
    assert.match(src, /getCurrentMembership/);
    assert.match(src, /reposFor/);
    assert.match(src, /SUPABASE_LIST_PAGE_SIZE/);
    // Business authorization asserts go through adapter remove/list/get, not raw JWT table deletes.
    assert.match(src, /expectDeleteDenied/);
  });

  it('workflow is workflow_dispatch only with dual confirms and branch guard', () => {
    const yml = readFileSync(
      join(root, '.github/workflows/staging-supabase-adapter-smoke.yml'),
      'utf8',
    );
    assert.match(yml, /workflow_dispatch/);
    assert.match(yml, /\nconcurrency:\n  group: etehad-staging-supabase-adapter-smoke\n  cancel-in-progress: false/);
    assert.doesNotMatch(yml, /\bpull_request\b/);
    assert.doesNotMatch(yml, /\bpush\b:/);
    assert.match(yml, /confirm_staging_run/);
    assert.match(yml, /confirm_migration_011_already_applied/);
    assert.match(yml, /feat\/etehad-supabase-adapter-staging-smoke-20261116/);
    assert.match(yml, /etehad-staging-security/);
    assert.match(yml, /test:staging-supabase-adapter/);
    assert.doesNotMatch(yml, /supabase db push|migration up|migrate/i);
  });

  it('package script uses tsx without new dependency declaration drift', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts['test:staging-supabase-adapter'], 'tsx scripts/staging-supabase-adapter-smoke.ts');
    assert.ok(pkg.devDependencies?.tsx);
  });


  it('runner recovers uncertain user and organization creates during cleanup', () => {
    const src = readFileSync(
      join(root, 'scripts/staging-supabase-adapter-smoke-lib.ts'),
      'utf8',
    );
    const extractTopLevelAsyncFunction = (name: string): string => {
      const header = `async function ${name}(`;
      const functionStart = src.indexOf(header);
      assert.notEqual(functionStart, -1, `${name} must exist`);
      // Skip parameter list (may contain type braces) then match body braces.
      let i = functionStart + header.length;
      let paren = 1;
      for (; i < src.length && paren > 0; i += 1) {
        if (src[i] === '(') paren += 1;
        else if (src[i] === ')') paren -= 1;
      }
      const bodyStart = src.indexOf('{', i);
      assert.notEqual(bodyStart, -1, `${name} must have a body`);
      let depth = 0;
      for (i = bodyStart; i < src.length; i += 1) {
        const ch = src[i];
        if (ch === '{') depth += 1;
        else if (ch === '}') {
          depth -= 1;
          if (depth === 0) return src.slice(functionStart, i + 1);
        }
      }
      assert.fail(`${name} must have a top-level closing brace`);
      return '';
    };

    assert.match(src, /randomBytes\(16\)/);
    assert.match(src, /uncertainCreateEmails\.add\(emails\.ownerA\)/);
    assert.match(src, /auth\.admin\.listUsers\(\{ page, perPage \}\)/);
    assert.match(src, /let cleanupUserIds = \[\.\.\.userIds\]/);
    assert.match(src, /try \{\s*cleanupUserIds = await discoverDisposableUserIds/);
    assert.match(src, /catch \{\s*cleanupFailures\.push\('user-discovery:unexpected'\)/);
    assert.match(src, /let cleanupOrganizationIds = knownOrganizationIds/);
    assert.match(src, /const discovery = await discoverOrganizationIds/);
    assert.match(src, /catch \{\s*cleanupFailures\.push\('org-discovery:unexpected'\)/);

    const userRecovery = extractTopLevelAsyncFunction('discoverDisposableUserIds');
    assert.match(userRecovery, /const discovered = new Set\(knownUserIds\)/);
    assert.match(userRecovery, /const pendingEmails = new Set\(\[\.\.\.uncertainCreateEmails\]\.map\(\(email\) => email\.toLowerCase\(\)\)\)/);
    assert.match(userRecovery, /user-discovery:invalid-user-record/);
    assert.match(userRecovery, /typeof id !== 'string' \|\| id\.length === 0/);
    assert.match(userRecovery, /const email = typeof rawEmail === 'string' \? rawEmail\.toLowerCase\(\) : '';/);
    assert.match(userRecovery, /if \(!email \|\| !pendingEmails\.has\(email\)\) continue;/);
    assert.match(
      userRecovery,
      /meta\.purpose !== 'staging-supabase-adapter-smoke' \|\|\s*meta\.run_id !== runId/,
    );
    assert.ok(
      userRecovery.indexOf('meta.run_id !== runId') < userRecovery.indexOf('discovered.add(id)'),
      'a recovered user must match the run metadata before its id is accepted',
    );
    assert.match(userRecovery, /pendingEmails\.delete\(email\)/);
    assert.match(userRecovery, /discovered\.add\(id\)/);
    assert.match(userRecovery, /const perPage = 1000/);
    assert.match(userRecovery, /const maxPages = 100/);
    assert.match(
      userRecovery,
      /if \(response\.error\) \{\s*cleanupFailures\.push\(`user-discovery:\$\{response\.error\.code \|\| 'error'\}`\);\s*return \[\.\.\.discovered\];\s*\}/,
    );
    assert.match(
      userRecovery,
      /if \(!Array\.isArray\(users\)\) \{\s*cleanupFailures\.push\('user-discovery:ambiguous-response'\);\s*return \[\.\.\.discovered\];\s*\}/,
    );
    assert.match(userRecovery, /user-discovery:page-limit/);

    const organizationRecovery = extractTopLevelAsyncFunction('discoverOrganizationIds');
    assert.match(organizationRecovery, /const discovered = new Set\(knownOrganizationIds\)/);
    assert.match(organizationRecovery, /expectedNameByOwnerId\.set\(expected\.userId, expected\.organizationName\)/);
    assert.match(organizationRecovery, /expectedOrganizationNames\.push\(expected\.organizationName\)/);
    assert.match(organizationRecovery, /org-discovery:invalid-expected-owner/);
    assert.match(
      organizationRecovery,
      /\.from\('organization_members'\)\s*\.select\('organization_id, user_id, role, status'\)\s*\.in\('user_id', userIds\)/,
    );
    assert.match(organizationRecovery, /classifyMembershipListRows\(userIds, response\.data\)/);
    assert.match(organizationRecovery, /org-discovery:ambiguous-membership-rows/);
    assert.match(
      organizationRecovery,
      /\.from\('organizations'\)\s*\.select\('id, name'\)\s*\.in\('name', expectedOrganizationNames\)/,
    );
    assert.match(organizationRecovery, /org-name-discovery:invalid-or-duplicate-row/);
    assert.match(organizationRecovery, /seenIds\.has\(id\)/);
    assert.match(organizationRecovery, /byName\.has\(name\)/);
    assert.match(organizationRecovery, /discovered\.add\(organization\.id\)/);
    assert.match(organizationRecovery, /row\.role !== 'owner' \|\| row\.status !== 'active'/);
    assert.match(organizationRecovery, /exactOrganizationId !== row\.organization_id/);
    assert.match(organizationRecovery, /ownerOrgLinks\.set\(/);
    assert.match(organizationRecovery, /foundNames\.has\(expected\.organizationName\)/);
    assert.match(organizationRecovery, /ownersWithNoMemberships\.delete\(expected\.userId\)/);
    assert.match(organizationRecovery, /org-name-discovery:exception:/);
    assert.match(organizationRecovery, /org-discovery:exception:/);
    assert.match(organizationRecovery, /if \(!hadErrors && memberships !== null/);

    assert.match(src, /const organizationNameA = `Adapter Smoke OrgA \$\{runId\}`/);
    assert.match(src, /const organizationNameB = `Adapter Smoke OrgB \$\{runId\}`/);
    assert.match(src, /extractOrganizationIdFromRpc\(createdA\.data, createdA\.error\)/);
    assert.match(src, /extractOrganizationIdFromRpc\(createdB\.data, createdB\.error\)/);
    assert.match(
      src,
      /expectedOrganizationOwners\.push\(\s*\{ userId: idOwnerA, organizationName: organizationNameA },\s*\{ userId: idOwnerB, organizationName: organizationNameB },\s*\);/,
    );
    // finally must call the production per-user helper (not an inline copy).
    assert.match(src, /resolveUnresolvedOwnersAfterDiscovery\(/);
    assert.match(src, /ownersWithNoMemberships: discovery\.ownersWithNoMemberships/);
    assert.match(src, /hadErrors: discovery\.hadErrors/);
  });

  it('cleanup gates Auth deleteUser behind residual org and owner-unresolved checks', () => {
    const lib = readFileSync(join(root, 'scripts/staging-supabase-adapter-smoke-lib.ts'), 'utf8');
    const gate = readFileSync(join(root, 'scripts/staging-supabase-adapter-smoke-gate.ts'), 'utf8');
    assert.match(lib, /shouldSkipDisposableUserDelete/);
    assert.match(lib, /residualOrgIds/);
    assert.match(lib, /unresolvedOwnerUserIds/);
    assert.match(lib, /ownerOrgByUserId/);
    assert.match(lib, /ownerOrgLinks/);
    assert.match(lib, /deleteDisposableUsersWithOwnerGate/);
    assert.match(lib, /user-skip:/);
    assert.match(gate, /owner-org-unresolved/);
    assert.match(gate, /org-residual/);
    assert.match(lib, /classifyListRead/);
    assert.match(lib, /classifyMaybeSingleRead/);
    assert.match(lib, /staging-supabase-adapter-smoke-gate/);

    const finallyStart = lib.indexOf('} finally {');
    assert.notEqual(finallyStart, -1);
    const finallyBlock = lib.slice(finallyStart);
    const residualPos = finallyBlock.indexOf('residualOrgIds');
    const gateCallPos = finallyBlock.indexOf('deleteDisposableUsersWithOwnerGate({');
    const deletePos = finallyBlock.indexOf('admin.auth.admin.deleteUser');
    assert.ok(residualPos > 0, 'residual org set must be built in finally');
    assert.ok(gateCallPos > residualPos, 'production gate path must run after residual read-back');
    assert.ok(deletePos > gateCallPos, 'deleteUser wiring must sit inside gated path');
    assert.match(lib, /discovery\.ownerOrgLinks/);
  });

  it('Dexie remains the default repositories export', () => {
    const idx = readFileSync(join(root, 'src/lib/repositories/index.ts'), 'utf8');
    assert.match(idx, /dexieRepositories/);
    assert.doesNotMatch(idx, /createSupabaseRepositories\(\)/);
  });
});

describe('classifyListRead / classifyMaybeSingleRead (behavioral)', () => {
  it('classifyListRead trusts only arrays', () => {
    assert.equal(classifyListRead([], null), 'absent');
    assert.equal(classifyListRead([{ id: '1' }], null), 'present');
    assert.equal(classifyListRead(null, null), 'ambiguous');
    assert.equal(classifyListRead(undefined, null), 'ambiguous');
    assert.equal(classifyListRead({ id: '1' }, null), 'ambiguous');
    assert.equal(classifyListRead([], { code: 'PGRST' }), 'error');
  });

  it('classifyMaybeSingleRead requires non-empty id for present', () => {
    assert.equal(classifyMaybeSingleRead(null, null), 'absent');
    assert.equal(classifyMaybeSingleRead({ id: 'org-1' }, null), 'present');
    assert.equal(classifyMaybeSingleRead(undefined, null), 'ambiguous');
    assert.equal(classifyMaybeSingleRead({}, null), 'ambiguous');
    assert.equal(classifyMaybeSingleRead({ id: '' }, null), 'ambiguous');
    assert.equal(classifyMaybeSingleRead({ id: null }, null), 'ambiguous');
    assert.equal(classifyMaybeSingleRead({ id: 'x' }, { code: '42501' }), 'error');
  });
});

describe('shouldSkipDisposableUserDelete gate (behavioral)', () => {
  it('1. residual organization blocks owner delete even when membership is absent', () => {
    assert.equal(
      shouldSkipDisposableUserDelete({
        relatedOrgIds: ['orgA'],
        residualOrgIds: new Set(['orgA']),
        membershipOutcome: 'absent',
      }),
      'org-residual',
    );
  });

  it('2. org readback error path is residual → owner blocked', () => {
    // residualOrgIds is populated by the runner on org-read error; gate sees residual.
    assert.equal(
      shouldSkipDisposableUserDelete({
        relatedOrgIds: ['orgA'],
        residualOrgIds: new Set(['orgA']),
        membershipOutcome: 'absent',
        ownerUnresolved: false,
      }),
      'org-residual',
    );
  });

  it('3. ambiguous membership outcome blocks delete', () => {
    assert.equal(
      shouldSkipDisposableUserDelete({
        relatedOrgIds: [],
        residualOrgIds: new Set(),
        membershipOutcome: 'ambiguous',
      }),
      'mem-read-ambiguous',
    );
  });

  it('4. unresolved owner (org discovery incomplete) is blocked even with clean membership', () => {
    assert.equal(
      shouldSkipDisposableUserDelete({
        relatedOrgIds: [],
        residualOrgIds: new Set(),
        membershipOutcome: 'absent',
        ownerUnresolved: true,
      }),
      'owner-org-unresolved',
    );
  });

  it('5. confirmed absent org + membership allows owner delete', () => {
    assert.equal(
      shouldSkipDisposableUserDelete({
        relatedOrgIds: ['orgA'],
        residualOrgIds: new Set(),
        membershipOutcome: 'absent',
        ownerUnresolved: false,
      }),
      null,
    );
  });

  it('6. per-owner: unresolved A does not force skip of resolved B', () => {
    const skipA = shouldSkipDisposableUserDelete({
      relatedOrgIds: ['orgA'],
      residualOrgIds: new Set(),
      membershipOutcome: 'absent',
      ownerUnresolved: true,
    });
    const skipB = shouldSkipDisposableUserDelete({
      relatedOrgIds: ['orgB'],
      residualOrgIds: new Set(),
      membershipOutcome: 'absent',
      ownerUnresolved: false,
    });
    assert.equal(skipA, 'owner-org-unresolved');
    assert.equal(skipB, null);
  });

  it('7. non-owner (admin/agent) is gated by membership only, not residual org map', () => {
    assert.equal(
      shouldSkipDisposableUserDelete({
        relatedOrgIds: [],
        residualOrgIds: new Set(['orgA']),
        membershipOutcome: 'absent',
        ownerUnresolved: false,
      }),
      null,
    );
    assert.equal(
      shouldSkipDisposableUserDelete({
        relatedOrgIds: [],
        residualOrgIds: new Set(['orgA']),
        membershipOutcome: 'present',
      }),
      'members-remain',
    );
  });

  it('8. deleteUser is not implied when gate returns a reason (caller must skip)', () => {
    const reason = shouldSkipDisposableUserDelete({
      relatedOrgIds: ['orgA'],
      residualOrgIds: new Set(['orgA']),
      membershipOutcome: 'error',
      membershipErrorCode: '57014',
      ownerUnresolved: false,
    });
    assert.equal(reason, 'org-residual');
    // residual checked before membership error in implementation; either way non-null blocks.
    assert.notEqual(reason, null);
  });

  it('membership read error blocks even without residual org', () => {
    assert.equal(
      shouldSkipDisposableUserDelete({
        relatedOrgIds: [],
        residualOrgIds: new Set(),
        membershipOutcome: 'error',
        membershipErrorCode: '57014',
      }),
      'mem-read:57014',
    );
  });

  it('unresolved wins over clean membership and empty residual', () => {
    assert.equal(
      shouldSkipDisposableUserDelete({
        relatedOrgIds: ['orgA'],
        residualOrgIds: new Set(),
        membershipOutcome: 'absent',
        ownerUnresolved: true,
      }),
      'owner-org-unresolved',
    );
  });
});


/**
 * Simulated cleanup loop: mirrors the production finally-block decision order
 * without touching Supabase. deleteUser is a spy.
 */

describe('deleteDisposableUsersWithOwnerGate (production path + spy)', () => {
  async function runProductionPath(args: {
    users: string[];
    ownerOrgByUserId: Map<string, string[]>;
    unresolvedOwnerUserIds: Set<string>;
    residualOrgIds: Set<string>;
    membershipByUser: Record<string, { data: unknown; error: { code?: string } | null }>;
  }) {
    const deleteCalls: string[] = [];
    const membershipCalls: string[] = [];
    const cleanupFailures: string[] = [];
    const result = await deleteDisposableUsersWithOwnerGate({
      cleanupUserIds: args.users,
      ownerOrgByUserId: args.ownerOrgByUserId,
      unresolvedOwnerUserIds: args.unresolvedOwnerUserIds,
      residualOrgIds: args.residualOrgIds,
      cleanupFailures,
      listMembershipsByUserId: async (uid) => {
        membershipCalls.push(uid);
        return args.membershipByUser[uid] ?? { data: [], error: null };
      },
      deleteUser: async (uid) => {
        deleteCalls.push(uid);
        return { error: null };
      },
    });
    return { ...result, deleteCalls, membershipCalls, cleanupFailures };
  }

  it('1. residual organization → zero deleteUser calls for that owner', async () => {
    const out = await runProductionPath({
      users: ['owner-a', 'admin-a'],
      ownerOrgByUserId: new Map([['owner-a', ['orgA']]]),
      unresolvedOwnerUserIds: new Set(),
      residualOrgIds: new Set(['orgA']),
      membershipByUser: {
        'owner-a': { data: [], error: null },
        'admin-a': { data: [], error: null },
      },
    });
    assert.equal(out.skippedUserIds.get('owner-a'), 'org-residual');
    assert.ok(!out.deleteCalls.includes('owner-a'));
    assert.deepEqual(out.deleteCalls, ['admin-a']);
    assert.ok(out.cleanupFailures.some((f) => f.includes('user-skip:') && f.includes('org-residual')));
  });

  it('2. membership read error → zero deleteUser calls', async () => {
    const out = await runProductionPath({
      users: ['owner-a'],
      ownerOrgByUserId: new Map([['owner-a', ['orgA']]]),
      unresolvedOwnerUserIds: new Set(),
      residualOrgIds: new Set(),
      membershipByUser: {
        'owner-a': { data: null, error: { code: '57014' } },
      },
    });
    assert.equal(out.skippedUserIds.get('owner-a'), 'mem-read:57014');
    assert.deepEqual(out.deleteCalls, []);
  });

  it('3. unresolved owner → zero deleteUser calls even with clean membership', async () => {
    const out = await runProductionPath({
      users: ['owner-a'],
      ownerOrgByUserId: new Map(),
      unresolvedOwnerUserIds: new Set(['owner-a']),
      residualOrgIds: new Set(),
      membershipByUser: {
        'owner-a': { data: [], error: null },
      },
    });
    assert.equal(out.skippedUserIds.get('owner-a'), 'owner-org-unresolved');
    assert.deepEqual(out.deleteCalls, []);
  });

  it('4. confirmed absence → exactly one deleteUser per owner', async () => {
    const out = await runProductionPath({
      users: ['owner-a', 'owner-b'],
      ownerOrgByUserId: new Map([
        ['owner-a', ['orgA']],
        ['owner-b', ['orgB']],
      ]),
      unresolvedOwnerUserIds: new Set(),
      residualOrgIds: new Set(),
      membershipByUser: {
        'owner-a': { data: [], error: null },
        'owner-b': { data: [], error: null },
      },
    });
    assert.equal(out.skippedUserIds.size, 0);
    assert.deepEqual(out.deleteCalls, ['owner-a', 'owner-b']);
    assert.deepEqual(out.deletedUserIds, ['owner-a', 'owner-b']);
  });

  it('5. owner A unresolved does not block safe delete of owner B', async () => {
    const out = await runProductionPath({
      users: ['owner-a', 'owner-b'],
      ownerOrgByUserId: new Map([['owner-b', ['orgB']]]),
      unresolvedOwnerUserIds: new Set(['owner-a']),
      residualOrgIds: new Set(),
      membershipByUser: {
        'owner-a': { data: [], error: null },
        'owner-b': { data: [], error: null },
      },
    });
    assert.equal(out.skippedUserIds.get('owner-a'), 'owner-org-unresolved');
    assert.ok(!out.deleteCalls.includes('owner-a'));
    assert.deepEqual(out.deleteCalls, ['owner-b']);
  });

  it('6. non-owner deleted only when membership absent', async () => {
    const blocked = await runProductionPath({
      users: ['admin-a'],
      ownerOrgByUserId: new Map(),
      unresolvedOwnerUserIds: new Set(),
      residualOrgIds: new Set(['orgA']),
      membershipByUser: {
        'admin-a': { data: [{ id: 'm1' }], error: null },
      },
    });
    assert.equal(blocked.skippedUserIds.get('admin-a'), 'members-remain');
    assert.deepEqual(blocked.deleteCalls, []);

    const allowed = await runProductionPath({
      users: ['admin-a'],
      ownerOrgByUserId: new Map(),
      unresolvedOwnerUserIds: new Set(),
      residualOrgIds: new Set(['orgA']),
      membershipByUser: {
        'admin-a': { data: [], error: null },
      },
    });
    assert.deepEqual(allowed.deleteCalls, ['admin-a']);
  });
});

describe('classifyMembershipListRows (strict row validation)', () => {
  it('empty array is valid and proves zero memberships for all requested users', () => {
    const classified = classifyMembershipListRows(['owner-a', 'owner-b'], []);
    assert.ok(classified !== null);
    assert.equal(classified!.presentUserIds.size, 0);
    const empty = ownersWithZeroMembershipRows(
      ['owner-a', 'owner-b'],
      classified!.presentUserIds,
    );
    assert.equal(empty.has('owner-a'), true);
    assert.equal(empty.has('owner-b'), true);
  });

  it('valid rows mark present user_ids; others remain zero-membership', () => {
    const classified = classifyMembershipListRows(
      ['owner-a', 'owner-b'],
      [
        { user_id: 'owner-a', role: 'agent', status: 'active' },
        { user_id: 'owner-a', role: 'owner', status: 'disabled' },
      ],
    );
    assert.ok(classified !== null);
    assert.equal(classified!.presentUserIds.has('owner-a'), true);
    assert.equal(classified!.presentUserIds.has('owner-b'), false);
    const empty = ownersWithZeroMembershipRows(
      ['owner-a', 'owner-b'],
      classified!.presentUserIds,
    );
    assert.equal(empty.has('owner-a'), false);
    assert.equal(empty.has('owner-b'), true);
  });

  it('non-string user_id makes the whole list ambiguous (fail-closed)', () => {
    assert.equal(
      classifyMembershipListRows(['owner-a'], [{ user_id: null }]),
      null,
    );
    assert.equal(
      classifyMembershipListRows(['owner-a'], [{ user_id: 1 }]),
      null,
    );
    assert.equal(classifyMembershipListRows(['owner-a'], [{}]), null);
  });

  it('null or non-object row is ambiguous', () => {
    assert.equal(classifyMembershipListRows(['owner-a'], [null]), null);
    assert.equal(classifyMembershipListRows(['owner-a'], ['x']), null);
  });

  it('user_id outside requested set is ambiguous', () => {
    assert.equal(
      classifyMembershipListRows(['owner-a'], [{ user_id: 'stranger' }]),
      null,
    );
  });

  it('empty string user_id is ambiguous', () => {
    assert.equal(
      classifyMembershipListRows(['owner-a'], [{ user_id: '' }]),
      null,
    );
  });
});

describe('resolveUnresolvedOwnersAfterDiscovery (production helper, A/B independence)', () => {
  it('both owners with zero memberships → both cleared', () => {
    const unresolved = resolveUnresolvedOwnersAfterDiscovery({
      expectedOwnerUserIds: ['owner-a', 'owner-b'],
      ownerOrgByUserId: new Map(),
      unresolvedOwnerUserIds: new Set(['owner-a', 'owner-b']),
      hadErrors: false,
      ownersWithNoMemberships: new Set(['owner-a', 'owner-b']),
    });
    assert.equal(unresolved.size, 0);
  });

  it('A empty + B confirmed owner link → both clear', () => {
    const unresolved = resolveUnresolvedOwnersAfterDiscovery({
      expectedOwnerUserIds: ['owner-a', 'owner-b'],
      ownerOrgByUserId: new Map([['owner-b', ['orgB']]]),
      unresolvedOwnerUserIds: new Set(['owner-a', 'owner-b']),
      hadErrors: false,
      ownersWithNoMemberships: new Set(['owner-a']),
    });
    assert.equal(unresolved.has('owner-a'), false);
    assert.equal(unresolved.has('owner-b'), false);
  });

  it('A unexpected membership + B empty → A unresolved, B cleared', () => {
    const unresolved = resolveUnresolvedOwnersAfterDiscovery({
      expectedOwnerUserIds: ['owner-a', 'owner-b'],
      ownerOrgByUserId: new Map(),
      unresolvedOwnerUserIds: new Set(['owner-a', 'owner-b']),
      hadErrors: false,
      ownersWithNoMemberships: new Set(['owner-b']),
    });
    assert.equal(unresolved.has('owner-a'), true);
    assert.equal(unresolved.has('owner-b'), false);
  });

  it('A name-mismatched owner membership + B confirmed link → A unresolved, B cleared', () => {
    const unresolved = resolveUnresolvedOwnersAfterDiscovery({
      expectedOwnerUserIds: ['owner-a', 'owner-b'],
      ownerOrgByUserId: new Map([['owner-b', ['orgB']]]),
      unresolvedOwnerUserIds: new Set(['owner-a', 'owner-b']),
      hadErrors: false,
      ownersWithNoMemberships: new Set(),
    });
    assert.equal(unresolved.has('owner-a'), true);
    assert.equal(unresolved.has('owner-b'), false);
  });

  it('discovery hadErrors → unconfirmed owners stay unresolved', () => {
    const unresolved = resolveUnresolvedOwnersAfterDiscovery({
      expectedOwnerUserIds: ['owner-a', 'owner-b'],
      ownerOrgByUserId: new Map([['owner-b', ['orgB']]]),
      unresolvedOwnerUserIds: new Set(),
      hadErrors: true,
      ownersWithNoMemberships: new Set(),
    });
    assert.equal(unresolved.has('owner-a'), true);
    assert.equal(unresolved.has('owner-b'), false);
  });

  it('ambiguous path (empty ownersWithNoMemberships + hadErrors) keeps unresolved', () => {
    const unresolved = resolveUnresolvedOwnersAfterDiscovery({
      expectedOwnerUserIds: ['owner-a'],
      ownerOrgByUserId: new Map(),
      unresolvedOwnerUserIds: new Set(['owner-a']),
      hadErrors: true,
      ownersWithNoMemberships: new Set(),
    });
    assert.equal(unresolved.has('owner-a'), true);
  });
});

describe('deleteDisposableUsersWithOwnerGate + resolved empty owner (integration)', () => {
  it('owner proven empty (not unresolved) is deleted when membership absent and no residual', async () => {
    const deleteCalls: string[] = [];
    const cleanupFailures: string[] = [];
    const result = await deleteDisposableUsersWithOwnerGate({
      cleanupUserIds: ['owner-a', 'owner-b'],
      ownerOrgByUserId: new Map(),
      // A cleared by proven-empty path; B still unresolved
      unresolvedOwnerUserIds: new Set(['owner-b']),
      residualOrgIds: new Set(),
      cleanupFailures,
      listMembershipsByUserId: async () => ({ data: [], error: null }),
      deleteUser: async (uid) => {
        deleteCalls.push(uid);
        return { error: null };
      },
    });
    assert.deepEqual(deleteCalls, ['owner-a']);
    assert.equal(result.skippedUserIds.get('owner-b'), 'owner-org-unresolved');
    assert.ok(!result.skippedUserIds.has('owner-a'));
  });

  it('residual org still blocks even when owner was cleared from unresolved', async () => {
    const deleteCalls: string[] = [];
    const cleanupFailures: string[] = [];
    const result = await deleteDisposableUsersWithOwnerGate({
      cleanupUserIds: ['owner-a'],
      ownerOrgByUserId: new Map([['owner-a', ['orgA']]]),
      unresolvedOwnerUserIds: new Set(), // cleared
      residualOrgIds: new Set(['orgA']),
      cleanupFailures,
      listMembershipsByUserId: async () => ({ data: [], error: null }),
      deleteUser: async (uid) => {
        deleteCalls.push(uid);
        return { error: null };
      },
    });
    assert.deepEqual(deleteCalls, []);
    assert.equal(result.skippedUserIds.get('owner-a'), 'org-residual');
  });
});

const BUSINESS_TABLES: BusinessCleanupTable[] = [
  'follow_ups',
  'needs',
  'properties',
  'clients',
  'activities',
];

type BusinessRead = { data: unknown; error: { code?: string; message?: string } | null };

function absentBusinessRead(): BusinessRead {
  return { data: [], error: null };
}

/**
 * Production sequence: business residual accumulation, then the owner gate.
 * deleteUser is a spy. Ownership comes only from the supplied confirmed map.
 */
async function deleteOwnersAfterBusinessRead(
  readTable: (orgId: string, table: BusinessCleanupTable) => Promise<BusinessRead> | BusinessRead,
) {
  const residualOrgIds = new Set<string>();
  const cleanupFailures: string[] = [];
  const deleteCalls: string[] = [];
  await accumulateBusinessTableResiduals({
    organizationIds: ['orgA', 'orgB'],
    labelForOrg: (orgId) => orgId,
    residualOrgIds,
    cleanupFailures,
    readTable: async (orgId, table) => readTable(orgId, table),
  });
  const gate = await deleteDisposableUsersWithOwnerGate({
    cleanupUserIds: ['owner-a', 'owner-b', 'agent-independent', 'admin-still-member'],
    ownerOrgByUserId: new Map<string, readonly string[]>([
      ['owner-a', ['orgA']],
      ['owner-b', ['orgB']],
    ]),
    unresolvedOwnerUserIds: new Set(),
    residualOrgIds,
    cleanupFailures,
    listMembershipsByUserId: async (uid) => {
      if (uid === 'admin-still-member') return { data: [{ id: 'membership-1' }], error: null };
      return { data: [], error: null };
    },
    deleteUser: async (uid) => {
      deleteCalls.push(uid);
      return { error: null };
    },
  });
  return { residualOrgIds, cleanupFailures, deleteCalls, gate };
}

function readOrgATable(
  badTable: BusinessCleanupTable,
  badRead: (table: BusinessCleanupTable) => BusinessRead,
) {
  return (orgId: string, table: BusinessCleanupTable): BusinessRead => {
    if (orgId === 'orgA' && table === badTable) return badRead(table);
    return absentBusinessRead();
  };
}

describe('business residual blocks owner Auth delete (production path + spy)', () => {
  it('runner accumulates business residuals before deleteDisposableUsersWithOwnerGate', () => {
    const lib = readFileSync(join(root, 'scripts/staging-supabase-adapter-smoke-lib.ts'), 'utf8');
    const finallyBlock = lib.slice(lib.indexOf('} finally {'));
    const residualPos = finallyBlock.indexOf('accumulateBusinessTableResiduals(');
    const gatePos = finallyBlock.indexOf('deleteDisposableUsersWithOwnerGate({');
    assert.ok(residualPos > 0, 'business residual helper must run in finally');
    assert.ok(gatePos > residualPos, 'owner gate must run after business residual accumulation');
  });

  it('present business row blocks that owner only', async () => {
    const out = await deleteOwnersAfterBusinessRead(
      readOrgATable('clients', () => ({ data: [{ id: 'client-row' }], error: null })),
    );
    assert.deepEqual(out.deleteCalls, ['owner-b', 'agent-independent']);
    assert.equal(out.gate.skippedUserIds.get('owner-a'), 'org-residual');
    assert.equal(out.gate.skippedUserIds.get('admin-still-member'), 'members-remain');
    assert.ok(out.residualOrgIds.has('orgA'));
    assert.equal(out.residualOrgIds.has('orgB'), false);
    assert.ok(out.cleanupFailures.some((failure) => failure === 'orgA-clients-remain'));
  });

  it('business read error blocks that owner only', async () => {
    const out = await deleteOwnersAfterBusinessRead(
      readOrgATable('needs', () => ({ data: null, error: { code: '42501' } })),
    );
    assert.deepEqual(out.deleteCalls, ['owner-b', 'agent-independent']);
    assert.equal(out.gate.skippedUserIds.get('owner-a'), 'org-residual');
    assert.ok(out.residualOrgIds.has('orgA'));
    assert.equal(out.residualOrgIds.has('orgB'), false);
    assert.ok(out.cleanupFailures.some((failure) => failure === 'orgA-needs-read:42501'));
  });

  it('ambiguous business read blocks that owner only', async () => {
    const out = await deleteOwnersAfterBusinessRead(
      readOrgATable('properties', () => ({ data: { id: 'not-a-list' }, error: null })),
    );
    assert.deepEqual(out.deleteCalls, ['owner-b', 'agent-independent']);
    assert.equal(out.gate.skippedUserIds.get('owner-a'), 'org-residual');
    assert.ok(out.residualOrgIds.has('orgA'));
    assert.equal(out.residualOrgIds.has('orgB'), false);
    assert.ok(out.cleanupFailures.some((failure) => failure === 'orgA-properties-read-ambiguous'));
  });

  it('business read exception blocks that owner only', async () => {
    const out = await deleteOwnersAfterBusinessRead((orgId, table) => {
      if (orgId === 'orgA' && table === 'activities') {
        throw new Error('activity read failed');
      }
      return absentBusinessRead();
    });
    assert.deepEqual(out.deleteCalls, ['owner-b', 'agent-independent']);
    assert.equal(out.gate.skippedUserIds.get('owner-a'), 'org-residual');
    assert.ok(out.residualOrgIds.has('orgA'));
    assert.equal(out.residualOrgIds.has('orgB'), false);
    assert.ok(
      out.cleanupFailures.some((failure) => failure.includes('orgA-activities-read:exception:')),
    );
  });

  it('valid absent business reads do not block owner delete', async () => {
    const seen: string[] = [];
    const out = await deleteOwnersAfterBusinessRead((orgId, table) => {
      seen.push(`${orgId}:${table}`);
      return absentBusinessRead();
    });
    assert.deepEqual(out.deleteCalls, ['owner-a', 'owner-b', 'agent-independent']);
    assert.equal(out.gate.skippedUserIds.get('admin-still-member'), 'members-remain');
    assert.equal(out.residualOrgIds.size, 0);
    assert.equal(
      out.cleanupFailures.some((failure) =>
        BUSINESS_TABLES.some((table) => failure.includes(`-${table}-`)),
      ),
      false,
    );
    for (const orgId of ['orgA', 'orgB']) {
      for (const table of BUSINESS_TABLES) {
        assert.ok(seen.includes(`${orgId}:${table}`));
      }
    }
  });

  it('org B residual does not block owner A', async () => {
    const out = await deleteOwnersAfterBusinessRead((orgId, table) => {
      if (orgId === 'orgB' && table === 'follow_ups') {
        return { data: [{ id: 'follow-up-row' }], error: null };
      }
      return absentBusinessRead();
    });
    assert.deepEqual(out.deleteCalls, ['owner-a', 'agent-independent']);
    assert.equal(out.gate.skippedUserIds.get('owner-b'), 'org-residual');
    assert.equal(out.residualOrgIds.has('orgA'), false);
    assert.ok(out.residualOrgIds.has('orgB'));
  });
});

const SMOKE_PURPOSE = 'staging-supabase-adapter-smoke';
const SMOKE_RUN = 'run-v44';

function discoveryAdmin(
  listUsers: (args: { page: number; perPage: number }) => Promise<{
    data?: { users?: unknown };
    error: { code?: string; message?: string } | null;
  }>,
): SupabaseClient {
  return { auth: { admin: { listUsers } } } as unknown as SupabaseClient;
}

function assertUnresolvedCleanupFails(failures: string[], secrets: readonly string[]) {
  assert.ok(failures.length > 0);
  assert.equal(cleanupStatusFromFailures(failures), 'FAIL');
  assert.equal(runnerShouldExitNonZero([{ status: 'PASS' }], failures), true);
  for (const failure of failures) {
    assert.equal(failure.includes('@'), false, failure);
    for (const secret of secrets) {
      assert.equal(failure.includes(secret), false, failure);
    }
  }
}

describe('pending email discovery fails cleanup (production helper)', () => {
  it('short listUsers page with a missing email records end-of-results and does not guess an id', async () => {
    const missing = 'Owner.Missing@Example.com';
    const failures: string[] = [];
    let calls = 0;
    const ids = await discoverDisposableUserIds(
      discoveryAdmin(async () => {
        calls += 1;
        return {
          data: {
            users: [
              {
                id: 'stranger-user',
                email: 'stranger@example.com',
                user_metadata: { purpose: SMOKE_PURPOSE, run_id: SMOKE_RUN },
              },
            ],
          },
          error: null,
        };
      }),
      new Set([missing]),
      SMOKE_RUN,
      ['known-user'],
      failures,
    );
    assert.equal(calls, 1);
    assert.deepEqual(ids, ['known-user']);
    assert.deepEqual(failures, ['user-discovery:end-of-results:unresolved=1']);
    assertUnresolvedCleanupFails(failures, [missing, 'stranger@example.com', 'stranger-user']);
  });

  it('all expected emails with exact metadata are recovered and cleanup can pass', async () => {
    const failures: string[] = [];
    const ids = await discoverDisposableUserIds(
      discoveryAdmin(async () => ({
        data: {
          users: [
            {
              id: 'user-a',
              email: 'A@Example.com',
              user_metadata: { purpose: SMOKE_PURPOSE, run_id: SMOKE_RUN },
            },
            {
              id: 'user-b',
              email: 'b@example.com',
              user_metadata: { purpose: SMOKE_PURPOSE, run_id: SMOKE_RUN },
            },
          ],
        },
        error: null,
      })),
      new Set(['a@example.com', 'b@example.com']),
      SMOKE_RUN,
      [],
      failures,
    );
    assert.deepEqual(new Set(ids), new Set(['user-a', 'user-b']));
    assert.deepEqual(failures, []);
    assert.equal(cleanupStatusFromFailures(failures), 'PASS');
    assert.equal(runnerShouldExitNonZero([{ status: 'PASS' }], failures), false);
  });

  it('wrong metadata is not accepted and stays unresolved', async () => {
    const wrongPurposeEmail = 'owner-purpose@example.com';
    const wrongRunEmail = 'owner-run@example.com';
    const failures: string[] = [];
    const ids = await discoverDisposableUserIds(
      discoveryAdmin(async () => ({
        data: {
          users: [
            {
              id: 'wrong-purpose-user',
              email: wrongPurposeEmail,
              user_metadata: { purpose: 'other-purpose', run_id: SMOKE_RUN },
            },
            {
              id: 'wrong-run-user',
              email: wrongRunEmail,
              user_metadata: { purpose: SMOKE_PURPOSE, run_id: 'other-run' },
            },
          ],
        },
        error: null,
      })),
      new Set([wrongPurposeEmail, wrongRunEmail]),
      SMOKE_RUN,
      [],
      failures,
    );
    assert.deepEqual(ids, []);
    assert.deepEqual(failures, ['user-discovery:end-of-results:unresolved=2']);
    assertUnresolvedCleanupFails(failures, [
      wrongPurposeEmail,
      wrongRunEmail,
      'wrong-purpose-user',
      'wrong-run-user',
    ]);
  });

  it('page limit with a remaining email records page-limit and does not guess an id', async () => {
    const missing = 'still-pending@example.com';
    const failures: string[] = [];
    let calls = 0;
    const filler = {
      id: 'filler-user',
      email: 'filler@example.invalid',
      user_metadata: { purpose: SMOKE_PURPOSE, run_id: 'not-this-run' },
    };
    const ids = await discoverDisposableUserIds(
      discoveryAdmin(async ({ page, perPage }) => {
        calls += 1;
        assert.equal(page, calls);
        assert.equal(perPage, 1000);
        return { data: { users: new Array(perPage).fill(filler) }, error: null };
      }),
      new Set([missing]),
      SMOKE_RUN,
      [],
      failures,
    );
    assert.equal(calls, 100);
    assert.deepEqual(ids, []);
    assert.deepEqual(failures, ['user-discovery:page-limit:unresolved=1']);
    assertUnresolvedCleanupFails(failures, [missing, 'filler@example.invalid', 'filler-user']);
  });

  it('no pending emails does not create a discovery failure', async () => {
    const failures: string[] = [];
    let calls = 0;
    const ids = await discoverDisposableUserIds(
      discoveryAdmin(async () => {
        calls += 1;
        return { data: { users: [] }, error: null };
      }),
      new Set(),
      SMOKE_RUN,
      ['known-user'],
      failures,
    );
    assert.equal(calls, 0);
    assert.deepEqual(ids, ['known-user']);
    assert.deepEqual(failures, []);
    assert.equal(cleanupStatusFromFailures(failures), 'PASS');
    assert.equal(runnerShouldExitNonZero([{ status: 'PASS' }], failures), false);
  });

  it('one resolved email and one missing email fails only the unresolved count', async () => {
    const missing = 'missing@example.com';
    const failures: string[] = [];
    const ids = await discoverDisposableUserIds(
      discoveryAdmin(async () => ({
        data: {
          users: [
            {
              id: 'user-ok',
              email: 'ok@example.com',
              user_metadata: { purpose: SMOKE_PURPOSE, run_id: SMOKE_RUN },
            },
            {
              id: 'decoy-user',
              email: 'decoy@example.com',
              user_metadata: { purpose: SMOKE_PURPOSE, run_id: SMOKE_RUN },
            },
          ],
        },
        error: null,
      })),
      new Set(['ok@example.com', missing]),
      SMOKE_RUN,
      [],
      failures,
    );
    assert.deepEqual(ids, ['user-ok']);
    assert.equal(ids.includes('decoy-user'), false);
    assert.deepEqual(failures, ['user-discovery:end-of-results:unresolved=1']);
    assertUnresolvedCleanupFails(failures, [missing, 'ok@example.com', 'decoy-user']);
  });

  it('api error, exception, and ambiguous list responses stay fail-closed', async () => {
    const apiFailures: string[] = [];
    const apiIds = await discoverDisposableUserIds(
      discoveryAdmin(async () => ({
        data: { users: [] },
        error: { code: 'over_request_rate_limit' },
      })),
      new Set(['pending@example.com']),
      SMOKE_RUN,
      ['known-user'],
      apiFailures,
    );
    assert.deepEqual(apiIds, ['known-user']);
    assert.deepEqual(apiFailures, ['user-discovery:over_request_rate_limit']);
    assert.equal(cleanupStatusFromFailures(apiFailures), 'FAIL');

    const thrownFailures: string[] = [];
    const thrownIds = await discoverDisposableUserIds(
      discoveryAdmin(async () => {
        throw new Error('list failed');
      }),
      new Set(['pending@example.com']),
      SMOKE_RUN,
      ['known-user'],
      thrownFailures,
    );
    assert.deepEqual(thrownIds, ['known-user']);
    assert.deepEqual(thrownFailures, ['user-discovery:exception:list failed']);
    assert.equal(runnerShouldExitNonZero([{ status: 'PASS' }], thrownFailures), true);

    const ambiguousFailures: string[] = [];
    const ambiguousIds = await discoverDisposableUserIds(
      discoveryAdmin(async () => ({ data: { users: { id: 'not-a-list' } }, error: null })),
      new Set(['pending@example.com']),
      SMOKE_RUN,
      [],
      ambiguousFailures,
    );
    assert.deepEqual(ambiguousIds, []);
    assert.deepEqual(ambiguousFailures, ['user-discovery:ambiguous-response']);
    assert.equal(cleanupStatusFromFailures(ambiguousFailures), 'FAIL');
  });

  it('null user record fails closed, preserves known ids, and never leaks email', async () => {
    const secretEmail = 'secret-owner@example.com';
    const failures: string[] = [];
    const ids = await discoverDisposableUserIds(
      discoveryAdmin(async () => ({
        data: {
          users: [
            null,
            {
              id: 'should-not-appear',
              email: secretEmail,
              user_metadata: { purpose: SMOKE_PURPOSE, run_id: SMOKE_RUN },
            },
          ],
        },
        error: null,
      })),
      new Set([secretEmail]),
      SMOKE_RUN,
      ['known-user'],
      failures,
    );
    assert.deepEqual(ids, ['known-user']);
    assert.equal(ids.includes('should-not-appear'), false);
    assert.deepEqual(failures, ['user-discovery:invalid-user-record']);
    assertUnresolvedCleanupFails(failures, [secretEmail, 'should-not-appear']);
  });

  it('non-object and array members fail closed without recovering later valid rows', async () => {
    const secretEmail = 'array-owner@example.com';
    const failures: string[] = [];
    const ids = await discoverDisposableUserIds(
      discoveryAdmin(async () => ({
        data: {
          users: [
            ['not', 'an', 'object'],
            {
              id: 'valid-but-after-invalid',
              email: secretEmail,
              user_metadata: { purpose: SMOKE_PURPOSE, run_id: SMOKE_RUN },
            },
          ],
        },
        error: null,
      })),
      new Set([secretEmail]),
      SMOKE_RUN,
      ['prior-known'],
      failures,
    );
    assert.deepEqual(ids, ['prior-known']);
    assert.equal(ids.includes('valid-but-after-invalid'), false);
    assert.deepEqual(failures, ['user-discovery:invalid-user-record']);
    assertUnresolvedCleanupFails(failures, [secretEmail, 'valid-but-after-invalid']);
  });

  it('matching email with missing id fails closed', async () => {
    const email = 'no-id@example.com';
    const failures: string[] = [];
    const ids = await discoverDisposableUserIds(
      discoveryAdmin(async () => ({
        data: {
          users: [
            {
              email,
              user_metadata: { purpose: SMOKE_PURPOSE, run_id: SMOKE_RUN },
            },
          ],
        },
        error: null,
      })),
      new Set([email]),
      SMOKE_RUN,
      [],
      failures,
    );
    assert.deepEqual(ids, []);
    assert.deepEqual(failures, ['user-discovery:invalid-user-record']);
    assertUnresolvedCleanupFails(failures, [email]);
  });

  it('numeric id is rejected and does not enter discovered', async () => {
    const email = 'numeric-id@example.com';
    const failures: string[] = [];
    const ids = await discoverDisposableUserIds(
      discoveryAdmin(async () => ({
        data: {
          users: [
            {
              id: 12345,
              email,
              user_metadata: { purpose: SMOKE_PURPOSE, run_id: SMOKE_RUN },
            },
          ],
        },
        error: null,
      })),
      new Set([email]),
      SMOKE_RUN,
      ['already-known'],
      failures,
    );
    assert.deepEqual(ids, ['already-known']);
    assert.equal(ids.includes(12345 as unknown as string), false);
    assert.deepEqual(failures, ['user-discovery:invalid-user-record']);
    assertUnresolvedCleanupFails(failures, [email, '12345']);
  });

  it('empty-string id is rejected', async () => {
    const email = 'empty-id@example.com';
    const failures: string[] = [];
    const ids = await discoverDisposableUserIds(
      discoveryAdmin(async () => ({
        data: {
          users: [
            {
              id: '',
              email,
              user_metadata: { purpose: SMOKE_PURPOSE, run_id: SMOKE_RUN },
            },
          ],
        },
        error: null,
      })),
      new Set([email]),
      SMOKE_RUN,
      [],
      failures,
    );
    assert.deepEqual(ids, []);
    assert.deepEqual(failures, ['user-discovery:invalid-user-record']);
    assertUnresolvedCleanupFails(failures, [email]);
  });

  it('valid record with correct metadata is recovered', async () => {
    const failures: string[] = [];
    const ids = await discoverDisposableUserIds(
      discoveryAdmin(async () => ({
        data: {
          users: [
            {
              id: 'valid-user-id',
              email: 'Valid@Example.com',
              user_metadata: { purpose: SMOKE_PURPOSE, run_id: SMOKE_RUN },
            },
          ],
        },
        error: null,
      })),
      new Set(['valid@example.com']),
      SMOKE_RUN,
      [],
      failures,
    );
    assert.deepEqual(ids, ['valid-user-id']);
    assert.deepEqual(failures, []);
  });

  it('valid record before an invalid record still recovers the valid id then fails closed', async () => {
    const goodEmail = 'good@example.com';
    const badEmail = 'bad@example.com';
    const failures: string[] = [];
    const ids = await discoverDisposableUserIds(
      discoveryAdmin(async () => ({
        data: {
          users: [
            {
              id: 'good-user',
              email: goodEmail,
              user_metadata: { purpose: SMOKE_PURPOSE, run_id: SMOKE_RUN },
            },
            null,
            {
              id: 'after-null',
              email: badEmail,
              user_metadata: { purpose: SMOKE_PURPOSE, run_id: SMOKE_RUN },
            },
          ],
        },
        error: null,
      })),
      new Set([goodEmail, badEmail]),
      SMOKE_RUN,
      ['seed-known'],
      failures,
    );
    assert.deepEqual(new Set(ids), new Set(['seed-known', 'good-user']));
    assert.equal(ids.includes('after-null'), false);
    assert.deepEqual(failures, ['user-discovery:invalid-user-record']);
    assertUnresolvedCleanupFails(failures, [goodEmail, badEmail, 'after-null']);
  });

  it('non-string email field fails closed without leaking values', async () => {
    const failures: string[] = [];
    const ids = await discoverDisposableUserIds(
      discoveryAdmin(async () => ({
        data: {
          users: [
            {
              id: 'weird-email-user',
              email: { nested: 'not-a-string' },
              user_metadata: { purpose: SMOKE_PURPOSE, run_id: SMOKE_RUN },
            },
          ],
        },
        error: null,
      })),
      new Set(['any@example.com']),
      SMOKE_RUN,
      [],
      failures,
    );
    assert.deepEqual(ids, []);
    assert.deepEqual(failures, ['user-discovery:invalid-user-record']);
    assert.equal(failures[0].includes('@'), false);
  });
});

/**
 * Injectable fake admin that supports the from().select().in() chain used by
 * discoverOrganizationIds. No real Supabase connection.
 */
function orgDiscoveryAdmin(handlers: {
  memberships?: (userIds: string[]) => Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
  organizations?: (names: string[]) => Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
}): SupabaseClient {
  const from = (table: string) => {
    const chain = {
      select: (_cols: string) => ({
        in: async (column: string, values: string[]) => {
          if (table === 'organization_members' && column === 'user_id') {
            if (!handlers.memberships) {
              return { data: [], error: null };
            }
            return handlers.memberships(values);
          }
          if (table === 'organizations' && column === 'name') {
            if (!handlers.organizations) {
              return { data: [], error: null };
            }
            return handlers.organizations(values);
          }
          return { data: null, error: { code: 'unexpected-table' } };
        },
      }),
    };
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}

describe('extractOrganizationIdFromRpc (runtime response validation)', () => {
  it('accepts exactly one non-empty string id from the table-returning RPC shape', () => {
    assert.equal(
      extractOrganizationIdFromRpc([{ organization_id: 'org-a' }], null),
      'org-a',
    );
    assert.equal(
      extractOrganizationIdFromRpc({ organization_id: 'org-a' }, null),
      'org-a',
    );
  });

  it('rejects missing, blank, non-string, whitespace-padded, multiple-row, and errored responses', () => {
    assert.equal(extractOrganizationIdFromRpc(null, null), null);
    assert.equal(extractOrganizationIdFromRpc([], null), null);
    assert.equal(extractOrganizationIdFromRpc([{ organization_id: '' }], null), null);
    assert.equal(extractOrganizationIdFromRpc([{ organization_id: '   ' }], null), null);
    assert.equal(extractOrganizationIdFromRpc([{ organization_id: 42 }], null), null);
    assert.equal(extractOrganizationIdFromRpc([{ organization_id: ' org-a ' }], null), null);
    assert.equal(
      extractOrganizationIdFromRpc(
        [{ organization_id: 'org-a' }, { organization_id: 'org-b' }],
        null,
      ),
      null,
    );
    assert.equal(extractOrganizationIdFromRpc([{ organization_id: 'org-a' }], { code: 'RPC' }), null);
  });
});

describe('organization discovery fails closed (production helper)', () => {
  const ownerA = { userId: 'owner-a', organizationName: 'Org A Exact' };
  const ownerB = { userId: 'owner-b', organizationName: 'Org B Exact' };

  it('active owner membership + exact org name recovers owner link', async () => {
    const failures: string[] = [];
    const result = await discoverOrganizationIds(
      orgDiscoveryAdmin({
        memberships: async () => ({
          data: [
            {
              organization_id: 'org-a',
              user_id: 'owner-a',
              role: 'owner',
              status: 'active',
            },
          ],
          error: null,
        }),
        organizations: async () => ({
          data: [{ id: 'org-a', name: 'Org A Exact' }],
          error: null,
        }),
      }),
      [ownerA],
      [],
      failures,
    );
    assert.deepEqual(result.organizationIds, ['org-a']);
    assert.deepEqual(result.ownerOrgLinks.get('owner-a'), ['org-a']);
    assert.equal(result.hadErrors, false);
    assert.deepEqual(failures, []);
  });

  it('mismatched organization name leaves owner unresolved with no link', async () => {
    const failures: string[] = [];
    const result = await discoverOrganizationIds(
      orgDiscoveryAdmin({
        memberships: async () => ({
          data: [
            {
              organization_id: 'org-a',
              user_id: 'owner-a',
              role: 'owner',
              status: 'active',
            },
          ],
          error: null,
        }),
        organizations: async () => ({
          data: [],
          error: null,
        }),
      }),
      [ownerA],
      [],
      failures,
    );
    assert.deepEqual(result.organizationIds, []);
    assert.equal(result.ownerOrgLinks.has('owner-a'), false);
    assert.equal(result.hadErrors, false);
    assert.deepEqual(failures, []);
  });

  it('non-owner role does not recover as confirmed owner org', async () => {
    const failures: string[] = [];
    const result = await discoverOrganizationIds(
      orgDiscoveryAdmin({
        memberships: async () => ({
          data: [
            {
              organization_id: 'org-a',
              user_id: 'owner-a',
              role: 'member',
              status: 'active',
            },
          ],
          error: null,
        }),
        organizations: async () => ({
          data: [{ id: 'org-a', name: 'Org A Exact' }],
          error: null,
        }),
      }),
      [ownerA],
      [],
      failures,
    );
    assert.deepEqual(result.organizationIds, ['org-a']);
    assert.equal(result.ownerOrgLinks.has('owner-a'), false);
    assert.equal(result.hadErrors, false);
  });

  it('inactive membership does not create owner link', async () => {
    const failures: string[] = [];
    const result = await discoverOrganizationIds(
      orgDiscoveryAdmin({
        memberships: async () => ({
          data: [
            {
              organization_id: 'org-a',
              user_id: 'owner-a',
              role: 'owner',
              status: 'inactive',
            },
          ],
          error: null,
        }),
        organizations: async () => ({
          data: [{ id: 'org-a', name: 'Org A Exact' }],
          error: null,
        }),
      }),
      [ownerA],
      [],
      failures,
    );
    assert.deepEqual(result.organizationIds, ['org-a']);
    assert.equal(result.ownerOrgLinks.has('owner-a'), false);
    assert.equal(result.hadErrors, false);
  });

  it('invalid membership response or invalid user_id sets hadErrors and fails closed', async () => {
    const failures: string[] = [];
    const result = await discoverOrganizationIds(
      orgDiscoveryAdmin({
        memberships: async () => ({
          data: [
            {
              organization_id: 'org-a',
              user_id: 999,
              role: 'owner',
              status: 'active',
            },
          ],
          error: null,
        }),
      }),
      [ownerA],
      [],
      failures,
    );
    assert.equal(result.hadErrors, true);
    assert.deepEqual(result.organizationIds, []);
    assert.equal(result.ownerOrgLinks.size, 0);
    assert.ok(failures.some((f) => f.includes('org-discovery')));
  });

  it('membership query error leaves owner unresolved without confirmed link', async () => {
    const failures: string[] = [];
    const result = await discoverOrganizationIds(
      orgDiscoveryAdmin({
        memberships: async () => ({
          data: null,
          error: { code: 'PGRST301' },
        }),
      }),
      [ownerA],
      ['already-known-org'],
      failures,
    );
    assert.deepEqual(result.organizationIds, ['already-known-org']);
    assert.equal(result.ownerOrgLinks.size, 0);
    assert.equal(result.hadErrors, true);
    assert.deepEqual(failures, ['org-discovery:PGRST301']);
  });

  it('organization name query error leaves owner unresolved', async () => {
    const failures: string[] = [];
    const result = await discoverOrganizationIds(
      orgDiscoveryAdmin({
        memberships: async () => ({
          data: [
            {
              organization_id: 'org-a',
              user_id: 'owner-a',
              role: 'owner',
              status: 'active',
            },
          ],
          error: null,
        }),
        organizations: async () => ({
          data: null,
          error: { code: 'PGRST116' },
        }),
      }),
      [ownerA],
      [],
      failures,
    );
    assert.deepEqual(result.organizationIds, []);
    assert.equal(result.ownerOrgLinks.size, 0);
    assert.equal(result.hadErrors, true);
    assert.deepEqual(failures, ['org-name-discovery:PGRST116']);
  });

  it('ambiguous organization query response does not create confirmed link', async () => {
    const failures: string[] = [];
    const result = await discoverOrganizationIds(
      orgDiscoveryAdmin({
        memberships: async () => ({
          data: [
            {
              organization_id: 'org-a',
              user_id: 'owner-a',
              role: 'owner',
              status: 'active',
            },
          ],
          error: null,
        }),
        organizations: async () => ({
          data: { id: 'not-a-list' },
          error: null,
        }),
      }),
      [ownerA],
      [],
      failures,
    );
    assert.deepEqual(result.organizationIds, []);
    assert.equal(result.ownerOrgLinks.size, 0);
    assert.equal(result.hadErrors, true);
    assert.deepEqual(failures, ['org-name-discovery:ambiguous-response']);
  });

  it('valid org A and invalid org B keep independent owner decisions', async () => {
    const failures: string[] = [];
    const result = await discoverOrganizationIds(
      orgDiscoveryAdmin({
        memberships: async () => ({
          data: [
            {
              organization_id: 'org-a',
              user_id: 'owner-a',
              role: 'owner',
              status: 'active',
            },
            {
              organization_id: 'org-b',
              user_id: 'owner-b',
              role: 'owner',
              status: 'active',
            },
          ],
          error: null,
        }),
        organizations: async (names) => {
          const rows = [];
          if (names.includes('Org A Exact')) rows.push({ id: 'org-a', name: 'Org A Exact' });
          return { data: rows, error: null };
        },
      }),
      [ownerA, ownerB],
      [],
      failures,
    );
    assert.deepEqual(result.organizationIds, ['org-a']);
    assert.deepEqual(result.ownerOrgLinks.get('owner-a'), ['org-a']);
    assert.equal(result.ownerOrgLinks.has('owner-b'), false);
    assert.equal(result.hadErrors, false);
    assert.deepEqual(failures, []);
  });

  it('zero memberships for one owner does not affect another owner', async () => {
    const failures: string[] = [];
    const result = await discoverOrganizationIds(
      orgDiscoveryAdmin({
        memberships: async () => ({
          data: [
            {
              organization_id: 'org-a',
              user_id: 'owner-a',
              role: 'owner',
              status: 'active',
            },
          ],
          error: null,
        }),
        organizations: async () => ({
          data: [{ id: 'org-a', name: 'Org A Exact' }],
          error: null,
        }),
      }),
      [ownerA, ownerB],
      [],
      failures,
    );
    assert.deepEqual(result.organizationIds, ['org-a']);
    assert.deepEqual(result.ownerOrgLinks.get('owner-a'), ['org-a']);
    assert.equal(result.ownerOrgLinks.has('owner-b'), false);
    assert.ok(result.ownersWithNoMemberships.has('owner-b'));
    assert.equal(result.ownersWithNoMemberships.has('owner-a'), false);
    assert.equal(result.hadErrors, false);
  });

  it('recovers an exact-name orphan organization when membership rows are absent, but keeps the owner unresolved', async () => {
    const failures: string[] = [];
    const result = await discoverOrganizationIds(
      orgDiscoveryAdmin({
        memberships: async () => ({ data: [], error: null }),
        organizations: async (names) => ({
          data: names.includes('Org A Exact')
            ? [{ id: 'orphan-org-a', name: 'Org A Exact' }]
            : [],
          error: null,
        }),
      }),
      [ownerA],
      [],
      failures,
    );

    assert.deepEqual(result.organizationIds, ['orphan-org-a']);
    assert.equal(result.ownerOrgLinks.has('owner-a'), false);
    assert.equal(result.ownersWithNoMemberships.has('owner-a'), false);
    assert.equal(result.hadErrors, false);

    const unresolved = new Set(['owner-a']);
    resolveUnresolvedOwnersAfterDiscovery({
      expectedOwnerUserIds: ['owner-a'],
      ownerOrgByUserId: result.ownerOrgLinks,
      unresolvedOwnerUserIds: unresolved,
      hadErrors: result.hadErrors,
      ownersWithNoMemberships: result.ownersWithNoMemberships,
    });
    assert.equal(unresolved.has('owner-a'), true);

    let deleteCalls = 0;
    const gated = await deleteDisposableUsersWithOwnerGate({
      cleanupUserIds: ['owner-a'],
      ownerOrgByUserId: result.ownerOrgLinks,
      unresolvedOwnerUserIds: unresolved,
      residualOrgIds: new Set<string>(),
      cleanupFailures: failures,
      listMembershipsByUserId: async () => ({ data: [], error: null }),
      deleteUser: async () => {
        deleteCalls += 1;
        return { error: null };
      },
    });
    assert.equal(deleteCalls, 0);
    assert.equal(gated.skippedUserIds.get('owner-a'), 'owner-org-unresolved');
    assert.ok(failures.some((failure) => failure.includes('user-skip:owner-a:owner-org-unresolved')));
  });

  it('still recovers the exact-name organization if membership discovery errors, without clearing owner protection', async () => {
    const failures: string[] = [];
    const result = await discoverOrganizationIds(
      orgDiscoveryAdmin({
        memberships: async () => ({ data: null, error: { code: 'PGRST301' } }),
        organizations: async (names) => ({
          data: names.includes('Org A Exact')
            ? [{ id: 'orphan-org-a', name: 'Org A Exact' }]
            : [],
          error: null,
        }),
      }),
      [ownerA],
      [],
      failures,
    );

    assert.deepEqual(result.organizationIds, ['orphan-org-a']);
    assert.equal(result.ownerOrgLinks.size, 0);
    assert.equal(result.ownersWithNoMemberships.size, 0);
    assert.equal(result.hadErrors, true);
    assert.ok(failures.includes('org-discovery:PGRST301'));
  });

  it('does not clear unresolved owner when an exact-name org exists but membership does not prove active ownership', async () => {
    const failures: string[] = [];
    const result = await discoverOrganizationIds(
      orgDiscoveryAdmin({
        memberships: async () => ({
          data: [{ organization_id: 'other-org', user_id: 'owner-a', role: 'agent', status: 'active' }],
          error: null,
        }),
        organizations: async (names) => ({
          data: names.includes('Org A Exact')
            ? [{ id: 'orphan-org-a', name: 'Org A Exact' }]
            : [],
          error: null,
        }),
      }),
      [ownerA],
      [],
      failures,
    );

    assert.deepEqual(result.organizationIds, ['orphan-org-a']);
    assert.equal(result.ownerOrgLinks.has('owner-a'), false);
    assert.equal(result.ownersWithNoMemberships.has('owner-a'), false);
    assert.equal(result.hadErrors, false);
  });

  it('fails closed on duplicate exact organization names instead of selecting one', async () => {
    const failures: string[] = [];
    const result = await discoverOrganizationIds(
      orgDiscoveryAdmin({
        memberships: async () => ({ data: [], error: null }),
        organizations: async () => ({
          data: [
            { id: 'org-a-1', name: 'Org A Exact' },
            { id: 'org-a-2', name: 'Org A Exact' },
          ],
          error: null,
        }),
      }),
      [ownerA],
      [],
      failures,
    );

    assert.deepEqual(result.organizationIds, []);
    assert.equal(result.hadErrors, true);
    assert.equal(result.ownersWithNoMemberships.size, 0);
    assert.ok(failures.includes('org-name-discovery:invalid-or-duplicate-row'));
  });

  it('organization-name query error never clears a zero-membership owner', async () => {
    const failures: string[] = [];
    const result = await discoverOrganizationIds(
      orgDiscoveryAdmin({
        memberships: async () => ({ data: [], error: null }),
        organizations: async () => ({ data: null, error: { code: 'ORG-READ' } }),
      }),
      [ownerA],
      [],
      failures,
    );

    assert.equal(result.hadErrors, true);
    assert.equal(result.ownersWithNoMemberships.has('owner-a'), false);
    assert.ok(failures.includes('org-name-discovery:ORG-READ'));
  });

  it('recovers exact-name org A without clearing it while independently clearing empty owner B', async () => {
    const failures: string[] = [];
    const result = await discoverOrganizationIds(
      orgDiscoveryAdmin({
        memberships: async () => ({ data: [], error: null }),
        organizations: async (names) => ({
          data: names.includes('Org A Exact')
            ? [{ id: 'orphan-org-a', name: 'Org A Exact' }]
            : [],
          error: null,
        }),
      }),
      [ownerA, ownerB],
      [],
      failures,
    );

    assert.deepEqual(result.organizationIds, ['orphan-org-a']);
    assert.equal(result.ownersWithNoMemberships.has('owner-a'), false);
    assert.equal(result.ownersWithNoMemberships.has('owner-b'), true);
    assert.equal(result.hadErrors, false);
  });

  it('fails closed when the exact-name query returns a row outside the expected names', async () => {
    const failures: string[] = [];
    const result = await discoverOrganizationIds(
      orgDiscoveryAdmin({
        memberships: async () => ({ data: [], error: null }),
        organizations: async () => ({
          data: [{ id: 'other-org', name: 'Unrelated Org' }],
          error: null,
        }),
      }),
      [ownerA],
      [],
      failures,
    );

    assert.deepEqual(result.organizationIds, []);
    assert.equal(result.hadErrors, true);
    assert.equal(result.ownersWithNoMemberships.size, 0);
  });

});
