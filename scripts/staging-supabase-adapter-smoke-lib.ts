/**
 * Staging adapter smoke implementation (shared lib).
 * Loaded by scripts/staging-supabase-adapter-smoke.ts
 */
/**
 * Opt-in Staging smoke: real createSupabaseRepositories() with JWT sessions.
 *
 * Does NOT apply migrations. Requires Migration 011 already applied on Staging.
 * Service role only for disposable users, membership seed, pagination seed, cleanup.
 * Never logs tokens, sessions, or secrets.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { getCurrentMembership } from '../src/lib/auth/organization';
import {
  createSupabaseRepositories,
  SUPABASE_LIST_PAGE_SIZE,
} from '../src/lib/repositories/supabaseRepositories';
import type { Repositories } from '../src/lib/repositories/types';
import {
  classifyListRead,
  classifyMaybeSingleRead,
  extractOrganizationIdFromRpc,
  shouldSkipDisposableUserDelete,
  classifyMembershipListRows,
  ownersWithZeroMembershipRows,
  resolveUnresolvedOwnersAfterDiscovery,
  type CleanupReadOutcome,
} from './staging-supabase-adapter-smoke-gate';

// Re-export gate helpers for contract/behavioral tests.
export {
  classifyListRead,
  classifyMaybeSingleRead,
  extractOrganizationIdFromRpc,
  shouldSkipDisposableUserDelete,
  classifyMembershipListRows,
  ownersWithZeroMembershipRows,
  resolveUnresolvedOwnersAfterDiscovery,
};
export type { CleanupReadOutcome };

const STAGING_ORIGIN = 'https://dezonafotwyvvghbccko.supabase.co';
const STAGING_CONFIRM = 'dezonafotwyvvghbccko';
const PRODUCTION_REF = 'gguvmewknanhzukugvpj';

type Status = 'PASS' | 'FAIL' | 'SKIP';
const results: Array<{ name: string; status: Status; detail: string }> = [];

function record(name: string, status: Status, detail: string) {
  results.push({ name, status, detail });
  const mark = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '○';
  console.log(`${mark} ${status} ${name}${detail ? ` — ${detail}` : ''}`);
}

function refusal(message: string): never {
  console.error(`REFUSAL: ${message}`);
  process.exit(2);
}

function loadConfig() {
  const urlRaw = process.env.STAGING_SUPABASE_URL;
  const anonKey = process.env.STAGING_SUPABASE_ANON_KEY;
  const serviceKey = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
  const confirm = process.env.STAGING_SECURITY_TEST_CONFIRM;
  const migration011 = process.env.STAGING_MIGRATION_011_CONFIRMED;

  if (!urlRaw || !anonKey || !serviceKey || !confirm) {
    refusal(
      'STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY, STAGING_SUPABASE_SERVICE_ROLE_KEY, and STAGING_SECURITY_TEST_CONFIRM are all required.',
    );
  }
  if (migration011 !== 'true') {
    refusal(
      "STAGING_MIGRATION_011_CONFIRMED must be exactly 'true'. This runner never applies migrations.",
    );
  }
  if (urlRaw.includes(PRODUCTION_REF)) {
    refusal('Production project reference is not allowed.');
  }
  let parsed: URL;
  try {
    parsed = new URL(urlRaw.trim());
  } catch {
    refusal('STAGING_SUPABASE_URL is not a valid URL.');
  }
  if (
    parsed.origin !== STAGING_ORIGIN ||
    parsed.username ||
    parsed.password ||
    parsed.protocol !== 'https:' ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    refusal('URL is not the pinned Staging origin.');
  }
  if (confirm !== STAGING_CONFIRM) {
    refusal('STAGING_SECURITY_TEST_CONFIRM does not match the pinned Staging project ref.');
  }
  try {
    const parts = anonKey.split('.');
    if (parts.length >= 2) {
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const pad = '='.repeat((4 - (b64.length % 4)) % 4);
      const payload = JSON.parse(Buffer.from(b64 + pad, 'base64').toString('utf8'));
      if (payload?.role === 'service_role') {
        refusal('STAGING_SUPABASE_ANON_KEY must not carry the service_role claim.');
      }
    }
  } catch {
    /* ignore parse */
  }
  return { url: STAGING_ORIGIN, anonKey, serviceKey };
}

function anonClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function adminClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function createDisposable(
  admin: SupabaseClient,
  email: string,
  runId: string,
  label: string,
): Promise<string> {
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { purpose: 'staging-supabase-adapter-smoke', run_id: runId, label },
  });
  if (created.error || !created.data?.user?.id) {
    throw new Error(`disposable user create failed (${label})`);
  }
  return created.data.user.id;
}

async function sessionFor(
  url: string,
  anonKey: string,
  admin: SupabaseClient,
  email: string,
  expectedId: string,
): Promise<SupabaseClient> {
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const hashed = link.data?.properties?.hashed_token;
  if (link.error || !hashed) throw new Error('session link generation failed');
  const client = anonClient(url, anonKey);
  const verified = await client.auth.verifyOtp({ type: 'magiclink', token_hash: hashed });
  if (verified.error || !verified.data?.session) throw new Error('session exchange failed');
  const who = await client.auth.getUser();
  if (who.error || who.data.user?.id !== expectedId) {
    throw new Error('session does not match the disposable user');
  }
  return client;
}

function reposFor(client: SupabaseClient): Repositories {
  return createSupabaseRepositories({
    supabase: client,
    getMembership: () => getCurrentMembership(client),
  });
}

type TableKey = 'properties' | 'clients' | 'needs' | 'followUps';

function denialKind(error: {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  name?: string;
} | null): string {
  if (!error) return 'none';
  const msg = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase();
  const code = String(error.code || '');
  const name = String(error.name || '');
  if (name === 'RepositoryNotFoundError') return 'not_found';
  if (
    code === 'PGRST301' ||
    msg.includes('jwt') ||
    msg.includes('not authenticated') ||
    msg.includes('invalid claim') ||
    name === 'RepositoryAuthError'
  ) {
    return 'auth';
  }
  if (
    code === '42501' ||
    msg.includes('permission denied') ||
    msg.includes('row-level security') ||
    msg.includes('violates row-level security')
  ) {
    return 'permission';
  }
  if (code === '23503' || msg.includes('foreign key')) return 'fk';
  if (msg.includes('timeout') || msg.includes('network') || msg.includes('fetch failed')) {
    return 'network';
  }
  return 'other';
}

function isAuthError(err: unknown): boolean {
  const name =
    err && typeof err === 'object' && 'name' in err ? String((err as { name: string }).name) : '';
  const msg = err instanceof Error ? err.message : String(err);
  return name === 'RepositoryAuthError' || /احراز هویت|عضویت فعال/.test(msg);
}

/** Only permission RLS denials and RepositoryNotFoundError (0-row RLS delete) count as valid. */
function classifyDeleteDenial(err: unknown): {
  valid: boolean;
  name: string;
  kind: string;
} {
  if (err == null) {
    return { valid: false, name: 'none', kind: 'none' };
  }
  const name =
    typeof err === 'object' && err !== null && 'name' in err
      ? String((err as { name: string }).name)
      : 'Error';
  const kind = denialKind(
    typeof err === 'object' && err !== null
      ? (err as { message?: string; code?: string; details?: string; hint?: string; name?: string })
      : { message: String(err) },
  );
  if (kind === 'not_found' || name === 'RepositoryNotFoundError') {
    return { valid: true, name: name || 'RepositoryNotFoundError', kind: 'not_found' };
  }
  if (kind === 'permission') {
    return { valid: true, name: name || 'Error', kind: 'permission' };
  }
  return { valid: false, name: name || 'Error', kind };
}

async function adapterRemove(repos: Repositories, table: TableKey, id: string): Promise<void> {
  if (table === 'properties') await repos.properties.remove(id);
  else if (table === 'clients') await repos.clients.remove(id);
  else if (table === 'needs') await repos.needs.remove(id);
  else await repos.followUps.remove(id);
}

async function adapterGet(
  repos: Repositories,
  table: TableKey,
  id: string,
): Promise<{ exists: boolean; readError: string | null }> {
  try {
    let row: { id: string } | undefined;
    if (table === 'properties') row = await repos.properties.get(id);
    else if (table === 'clients') row = await repos.clients.get(id);
    else if (table === 'needs') row = await repos.needs.get(id);
    else row = await repos.followUps.get(id);
    return { exists: !!row?.id, readError: null };
  } catch (e) {
    const name =
      e && typeof e === 'object' && 'name' in e ? String((e as { name: string }).name) : 'Error';
    const kind = denialKind(
      e as { message?: string; code?: string; details?: string; hint?: string; name?: string },
    );
    return { exists: false, readError: `${name}/${kind}` };
  }
}

async function expectDeleteDenied(
  label: string,
  remover: Repositories,
  table: TableKey,
  id: string,
  reader: Repositories,
): Promise<void> {
  let threw = false;
  let classification = { valid: false, name: 'none', kind: 'none' };
  try {
    await adapterRemove(remover, table, id);
  } catch (e) {
    threw = true;
    classification = classifyDeleteDenial(e);
  }

  const read = await adapterGet(reader, table, id);
  // Valid denial requires: threw + (permission | RepositoryNotFoundError) + row still present via authorized reader
  // Silent success (no throw) is never PASS even if row remains.
  const ok =
    threw &&
    classification.valid &&
    read.exists === true &&
    read.readError === null;

  record(
    label,
    ok ? 'PASS' : 'FAIL',
    `threw=${threw} errName=${classification.name} kind=${classification.kind} stillThere=${read.exists} readErr=${read.readError ?? 'none'}`,
  );
}

async function expectDeleteAllowed(
  label: string,
  remover: Repositories,
  table: TableKey,
  id: string,
  reader: Repositories,
): Promise<void> {
  let threw = false;
  let errName = 'none';
  let kind = 'none';
  try {
    await adapterRemove(remover, table, id);
  } catch (e) {
    threw = true;
    const c = classifyDeleteDenial(e);
    errName = c.name;
    kind = c.kind;
    if (!c.valid && e && typeof e === 'object' && 'name' in e) {
      errName = String((e as { name: string }).name);
      kind = denialKind(e as { message?: string; code?: string; name?: string });
    }
  }
  const read = await adapterGet(reader, table, id);
  const ok = !threw && read.exists === false && read.readError === null;
  record(
    label,
    ok ? 'PASS' : 'FAIL',
    `threw=${threw} errName=${errName} kind=${kind} stillThere=${read.exists} readErr=${read.readError ?? 'none'}`,
  );
}

async function checkedDelete(
  admin: SupabaseClient,
  table: string,
  filterCol: string,
  filterVal: string,
  cleanupFailures: string[],
  label: string,
): Promise<void> {
  try {
    const res = await admin.from(table).delete().eq(filterCol, filterVal).select('id');
    if (res.error) {
      cleanupFailures.push(`${label}:${res.error.code || 'error'}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    cleanupFailures.push(`${label}:exception:${msg.slice(0, 80)}`);
  }
}


/**
 * Recover disposable users whose createUser request may have committed remotely
 * even though the caller did not receive the response. Only exact generated
 * emails with matching purpose + run_id metadata are eligible for cleanup.
 * After a normal scan, any email still pending is a cleanup failure. No user id
 * is guessed from a partial match or from metadata that is not this run.
 */
export async function discoverDisposableUserIds(
  admin: SupabaseClient,
  uncertainCreateEmails: Set<string>,
  runId: string,
  knownUserIds: string[],
  cleanupFailures: string[],
): Promise<string[]> {
  const discovered = new Set(knownUserIds);
  const pendingEmails = new Set([...uncertainCreateEmails].map((email) => email.toLowerCase()));
  if (pendingEmails.size === 0) return [...discovered];

  const perPage = 1000;
  const maxPages = 100;
  let endedByShortPage = false;

  for (let page = 1; page <= maxPages; page += 1) {
    let response;
    try {
      response = await admin.auth.admin.listUsers({ page, perPage });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      cleanupFailures.push(`user-discovery:exception:${message.slice(0, 80)}`);
      return [...discovered];
    }
    if (response.error) {
      cleanupFailures.push(`user-discovery:${response.error.code || 'error'}`);
      return [...discovered];
    }

    const users = response.data?.users;
    if (!Array.isArray(users)) {
      cleanupFailures.push('user-discovery:ambiguous-response');
      return [...discovered];
    }

    for (const user of users) {
      // Fail-closed structural validation: only plain non-null objects are accepted.
      if (user === null || typeof user !== 'object' || Array.isArray(user)) {
        cleanupFailures.push('user-discovery:invalid-user-record');
        return [...discovered];
      }
      const record = user as unknown as Record<string, unknown>;
      const id = record.id;
      if (typeof id !== 'string' || id.length === 0) {
        cleanupFailures.push('user-discovery:invalid-user-record');
        return [...discovered];
      }
      // email may be absent; when present it must be a string. Never throw on access.
      const rawEmail = record.email;
      if (rawEmail !== undefined && rawEmail !== null && typeof rawEmail !== 'string') {
        cleanupFailures.push('user-discovery:invalid-user-record');
        return [...discovered];
      }
      const email = typeof rawEmail === 'string' ? rawEmail.toLowerCase() : '';
      if (!email || !pendingEmails.has(email)) continue;

      const metadata = record.user_metadata;
      if (
        metadata === null ||
        typeof metadata !== 'object' ||
        Array.isArray(metadata)
      ) {
        continue;
      }
      const meta = metadata as Record<string, unknown>;
      if (
        meta.purpose !== 'staging-supabase-adapter-smoke' ||
        meta.run_id !== runId
      ) {
        continue;
      }
      discovered.add(id);
      pendingEmails.delete(email);
    }

    if (pendingEmails.size === 0) break;
    if (users.length < perPage) {
      endedByShortPage = true;
      break;
    }
  }

  // Fail closed on any unresolved email after a normal scan. This does not
  // depend on a scanComplete flag: a short final page must not look finished
  // while expected emails are still missing. Do not log the emails themselves.
  if (pendingEmails.size > 0) {
    if (endedByShortPage) {
      cleanupFailures.push(`user-discovery:end-of-results:unresolved=${pendingEmails.size}`);
    } else {
      cleanupFailures.push(`user-discovery:page-limit:unresolved=${pendingEmails.size}`);
    }
  }
  return [...discovered];
}

/**
 * Recover organizations created by disposable users if the create-organization
 * RPC committed but its response was lost. Exact, run-specific organization
 * names recover orphan candidates even when membership discovery fails.
 *
 * An exact name match is sufficient to enqueue only that named org for cleanup;
 * it is NOT proof of owner identity. ownerOrgLinks is populated only when the
 * membership row has the expected user_id, role owner, status active, and points
 * to the organization returned for that owner's exact name.
 *
 * Any query error or ambiguous payload sets hadErrors. A zero-membership owner is
 * cleared from unresolved only when both reads succeeded and no exact-name org
 * exists for that owner. This prevents a missing/mismatched owner link from
 * becoming permission to delete the Auth user.
 */
export type OrgDiscoveryResult = {
  organizationIds: string[];
  /** Confirmed owner userId → organization ids matched in this discovery. */
  ownerOrgLinks: Map<string, string[]>;
  hadErrors: boolean;
  /**
   * Expected owner user_ids with no membership rows AND no exact-name org row,
   * after both discovery reads succeeded and were structurally valid.
   * Empty when hadErrors is true.
   */
  ownersWithNoMemberships: ReadonlySet<string>;
};

export async function discoverOrganizationIds(
  admin: SupabaseClient,
  expectedOwners: Array<{ userId: string; organizationName: string }>,
  knownOrganizationIds: string[],
  cleanupFailures: string[],
): Promise<OrgDiscoveryResult> {
  const discovered = new Set(knownOrganizationIds);
  const ownerOrgLinks = new Map<string, string[]>();
  const emptyNoMemberships = new Set<string>();

  // These names contain this run's 128-bit random id. They are exact recovery
  // keys, not prefixes. Reject duplicate/malformed keys rather than broadening
  // discovery or allowing an owner to be cleared on ambiguous input.
  const expectedNameByOwnerId = new Map<string, string>();
  const expectedOrganizationNames: string[] = [];
  const seenOwnerIds = new Set<string>();
  const seenOrganizationNames = new Set<string>();
  for (const expected of expectedOwners) {
    if (
      expected === null ||
      expected === undefined ||
      typeof expected !== 'object' ||
      typeof expected.userId !== 'string' ||
      expected.userId.trim().length === 0 ||
      expected.userId !== expected.userId.trim() ||
      typeof expected.organizationName !== 'string' ||
      expected.organizationName.trim().length === 0 ||
      expected.organizationName !== expected.organizationName.trim() ||
      seenOwnerIds.has(expected.userId) ||
      seenOrganizationNames.has(expected.organizationName)
    ) {
      cleanupFailures.push('org-discovery:invalid-expected-owner');
      return {
        organizationIds: [...discovered],
        ownerOrgLinks,
        hadErrors: true,
        ownersWithNoMemberships: emptyNoMemberships,
      };
    }
    seenOwnerIds.add(expected.userId);
    seenOrganizationNames.add(expected.organizationName);
    expectedNameByOwnerId.set(expected.userId, expected.organizationName);
    expectedOrganizationNames.push(expected.organizationName);
  }

  const userIds = [...expectedNameByOwnerId.keys()];
  if (userIds.length === 0) {
    return {
      organizationIds: [...discovered],
      ownerOrgLinks,
      hadErrors: false,
      ownersWithNoMemberships: emptyNoMemberships,
    };
  }

  let hadErrors = false;
  let memberships: unknown[] | null = null;
  let membershipPresentUserIds: Set<string> | null = null;

  // Read memberships, but do not return early on failure: exact organization-name
  // recovery is independent and can still identify an orphaned run-created org.
  try {
    const response = await admin
      .from('organization_members')
      .select('organization_id, user_id, role, status')
      .in('user_id', userIds);
    if (response.error) {
      cleanupFailures.push(`org-discovery:${response.error.code || 'error'}`);
      hadErrors = true;
    } else if (!Array.isArray(response.data)) {
      cleanupFailures.push('org-discovery:ambiguous-response');
      hadErrors = true;
    } else {
      const classified = classifyMembershipListRows(userIds, response.data);
      if (classified === null) {
        cleanupFailures.push('org-discovery:ambiguous-membership-rows');
        hadErrors = true;
      } else {
        memberships = response.data;
        membershipPresentUserIds = classified.presentUserIds;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cleanupFailures.push(`org-discovery:exception:${message.slice(0, 80)}`);
    hadErrors = true;
  }

  // Query only exact, unpredictable names generated for this run. This catches
  // organizations whose create RPC committed but whose owner-membership row is
  // no longer visible. A name match permits cleanup of that exact disposable org,
  // but does NOT prove its owner link; the user remains unresolved unless a
  // matching active owner membership independently confirms the relationship.
  let organizationsByName: Array<{ id: string; name: string }> | null = null;
  try {
    const response = await admin
      .from('organizations')
      .select('id, name')
      .in('name', expectedOrganizationNames);
    if (response.error) {
      cleanupFailures.push(`org-name-discovery:${response.error.code || 'error'}`);
      hadErrors = true;
    } else if (!Array.isArray(response.data)) {
      cleanupFailures.push('org-name-discovery:ambiguous-response');
      hadErrors = true;
    } else {
      const byName = new Map<string, string>();
      const seenIds = new Set<string>();
      let invalidRows = false;
      for (const organization of response.data) {
        if (
          organization === null ||
          typeof organization !== 'object' ||
          Array.isArray(organization)
        ) {
          invalidRows = true;
          break;
        }
        const row = organization as Record<string, unknown>;
        const id = row.id;
        const name = row.name;
        if (
          typeof id !== 'string' ||
          id.length === 0 ||
          typeof name !== 'string' ||
          !seenOrganizationNames.has(name) ||
          byName.has(name) ||
          seenIds.has(id)
        ) {
          // A malformed, unexpected, or duplicate result is ambiguous. Do not
          // choose one candidate or delete any of the rows by approximation.
          invalidRows = true;
          break;
        }
        byName.set(name, id);
        seenIds.add(id);
      }

      if (invalidRows) {
        cleanupFailures.push('org-name-discovery:invalid-or-duplicate-row');
        hadErrors = true;
      } else {
        organizationsByName = response.data as Array<{ id: string; name: string }>;
        for (const organization of organizationsByName) {
          byName.set(organization.name, organization.id);
          discovered.add(organization.id);
        }

        // Only a matching active owner membership for this owner's exact name
        // creates an owner→org link. Any mismatch leaves the owner unresolved.
        if (memberships !== null && membershipPresentUserIds !== null) {
          for (const membership of memberships) {
            const row = membership as Record<string, unknown>;
            const ownerId = row.user_id as string;
            const expectedName = expectedNameByOwnerId.get(ownerId);
            if (!expectedName || row.role !== 'owner' || row.status !== 'active') continue;
            if (
              typeof row.organization_id !== 'string' ||
              row.organization_id.length === 0
            ) continue;
            const exactOrganizationId = byName.get(expectedName);
            if (exactOrganizationId !== row.organization_id) continue;

            const existing = ownerOrgLinks.get(ownerId) ?? [];
            if (!existing.includes(exactOrganizationId)) existing.push(exactOrganizationId);
            ownerOrgLinks.set(ownerId, existing);
          }
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cleanupFailures.push(`org-name-discovery:exception:${message.slice(0, 80)}`);
    hadErrors = true;
  }

  let ownersWithNoMemberships = emptyNoMemberships;
  // A zero-membership result clears unresolved only if the exact run-specific
  // organization name is also absent. If the named org exists but its owner link
  // is missing/mismatched, preserve unresolved so Auth deleteUser stays blocked.
  if (!hadErrors && memberships !== null && membershipPresentUserIds !== null) {
    ownersWithNoMemberships = ownersWithZeroMembershipRows(userIds, membershipPresentUserIds);
    if (organizationsByName !== null) {
      const foundNames = new Set(organizationsByName.map((organization) => organization.name));
      for (const expected of expectedOwners) {
        if (foundNames.has(expected.organizationName)) {
          ownersWithNoMemberships.delete(expected.userId);
        }
      }
    }
  }

  return {
    organizationIds: [...discovered],
    ownerOrgLinks,
    hadErrors,
    ownersWithNoMemberships,
  };
}

const BUSINESS_CLEANUP_TABLES = ['follow_ups', 'needs', 'properties', 'clients', 'activities'] as const;
export type BusinessCleanupTable = (typeof BUSINESS_CLEANUP_TABLES)[number];

/**
 * Fail-closed business-data residual applied before Auth owner deletion.
 * present, error, ambiguous, and thrown reads add that org id to residualOrgIds
 * and record a cleanup failure. Only a valid absent classification leaves the
 * org out of the residual set for that table. Does not invent owner links.
 */
export async function accumulateBusinessTableResiduals(args: {
  organizationIds: readonly string[];
  labelForOrg: (orgId: string) => string;
  residualOrgIds: Set<string>;
  cleanupFailures: string[];
  readTable: (
    orgId: string,
    table: BusinessCleanupTable,
  ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
}): Promise<void> {
  for (const orgId of args.organizationIds) {
    const label = args.labelForOrg(orgId);
    for (const table of BUSINESS_CLEANUP_TABLES) {
      try {
        const rowChk = await args.readTable(orgId, table);
        const rowOutcome = classifyListRead(rowChk.data, rowChk.error);
        if (rowOutcome === 'absent') continue;
        args.residualOrgIds.add(orgId);
        if (rowOutcome === 'error') {
          args.cleanupFailures.push(`${label}-${table}-read:${rowChk.error?.code || 'error'}`);
        } else if (rowOutcome === 'ambiguous') {
          args.cleanupFailures.push(`${label}-${table}-read-ambiguous`);
        } else {
          args.cleanupFailures.push(`${label}-${table}-remain`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        args.cleanupFailures.push(`${label}-${table}-read:exception:${msg.slice(0, 80)}`);
        args.residualOrgIds.add(orgId);
      }
    }
  }
}

/** CLEANUP PASS is allowed only when no cleanup failure was recorded. */
export function cleanupStatusFromFailures(cleanupFailures: readonly string[]): 'PASS' | 'FAIL' {
  return cleanupFailures.length === 0 ? 'PASS' : 'FAIL';
}

/** Runner fails when any check failed or cleanupFailures is non-empty. */
export function runnerShouldExitNonZero(
  results: readonly { status: string }[],
  cleanupFailures: readonly string[],
): boolean {
  const failed = results.filter((result) => result.status === 'FAIL').length;
  return failed > 0 || cleanupFailures.length > 0;
}

/**
 * Production Auth-user cleanup path used by runAdapterSmoke finally.
 * Dependencies are injectable so contract tests can spy deleteUser / membership reads
 * without touching Staging.
 */
export async function deleteDisposableUsersWithOwnerGate(args: {
  cleanupUserIds: readonly string[];
  ownerOrgByUserId: ReadonlyMap<string, readonly string[]>;
  unresolvedOwnerUserIds: ReadonlySet<string>;
  residualOrgIds: ReadonlySet<string>;
  cleanupFailures: string[];
  listMembershipsByUserId: (uid: string) => Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
  deleteUser: (uid: string) => Promise<{ error: { message?: string } | null }>;
}): Promise<{ deletedUserIds: string[]; skippedUserIds: Map<string, string> }> {
  const deletedUserIds: string[] = [];
  const skippedUserIds = new Map<string, string>();

  for (const uid of args.cleanupUserIds) {
    const relatedOrgs = [...(args.ownerOrgByUserId.get(uid) ?? [])];
    let membershipOutcome: CleanupReadOutcome = 'absent';
    let membershipErrorCode: string | undefined;

    try {
      const memByUser = await args.listMembershipsByUserId(uid);
      membershipOutcome = classifyListRead(memByUser.data, memByUser.error);
      if (memByUser.error) membershipErrorCode = memByUser.error.code || 'error';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      membershipOutcome = 'error';
      membershipErrorCode = `exception:${msg.slice(0, 80)}`;
    }

    const skipReason = shouldSkipDisposableUserDelete({
      relatedOrgIds: relatedOrgs,
      residualOrgIds: args.residualOrgIds,
      membershipOutcome,
      membershipErrorCode,
      ownerUnresolved: args.unresolvedOwnerUserIds.has(uid),
    });

    if (skipReason) {
      skippedUserIds.set(uid, skipReason);
      args.cleanupFailures.push(`user-skip:${uid.slice(0, 8)}:${skipReason}`);
      continue;
    }

    try {
      const del = await args.deleteUser(uid);
      if (del.error) {
        args.cleanupFailures.push(`user-del:${uid.slice(0, 8)}:${del.error.message || 'error'}`);
      } else {
        deletedUserIds.push(uid);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      args.cleanupFailures.push(`user-ex:${uid.slice(0, 8)}:${msg.slice(0, 80)}`);
    }
  }

  return { deletedUserIds, skippedUserIds };
}

export async function runAdapterSmoke() {
  const { url, anonKey, serviceKey } = loadConfig();
  const runId = randomBytes(16).toString('hex');
  const admin = adminClient(url, serviceKey);
  const cleanupFailures: string[] = [];
  const userIds: string[] = [];
  // Track requests until a user id is confirmed; a lost response leaves the email
  // here so cleanup can recover any user created remotely.
  const uncertainCreateEmails = new Set<string>();
  // Only recover organizations whose exact run-specific name and active owner
  // membership match one of the disposable owner accounts created for this run.
  const expectedOrganizationOwners: Array<{ userId: string; organizationName: string }> = [];
  /** Confirmed owner userId → organization ids owned in this run. */
  const ownerOrgByUserId = new Map<string, string[]>();
  /** Owners whose organization link is not proven absent; blocks Auth delete. */
  const unresolvedOwnerUserIds = new Set<string>();
  let orgAId: string | null = null;
  let orgBId: string | null = null;

  const emails = {
    ownerA: `adapter-owner-a-${runId}@example.invalid`,
    adminA: `adapter-admin-a-${runId}@example.invalid`,
    agentA: `adapter-agent-a-${runId}@example.invalid`,
    ownerB: `adapter-owner-b-${runId}@example.invalid`,
  };

  console.log(`Adapter Staging smoke run_id=${runId} pageSize=${SUPABASE_LIST_PAGE_SIZE}`);
  console.log(`Cleanup reference run_id=${runId}`);

  try {
    uncertainCreateEmails.add(emails.ownerA);
    const idOwnerA = await createDisposable(admin, emails.ownerA, runId, 'ownerA');
    uncertainCreateEmails.delete(emails.ownerA);
    userIds.push(idOwnerA);
    uncertainCreateEmails.add(emails.adminA);
    const idAdminA = await createDisposable(admin, emails.adminA, runId, 'adminA');
    uncertainCreateEmails.delete(emails.adminA);
    userIds.push(idAdminA);
    uncertainCreateEmails.add(emails.agentA);
    const idAgentA = await createDisposable(admin, emails.agentA, runId, 'agentA');
    uncertainCreateEmails.delete(emails.agentA);
    userIds.push(idAgentA);
    uncertainCreateEmails.add(emails.ownerB);
    const idOwnerB = await createDisposable(admin, emails.ownerB, runId, 'ownerB');
    uncertainCreateEmails.delete(emails.ownerB);
    userIds.push(idOwnerB);

    const clientOwnerA = await sessionFor(url, anonKey, admin, emails.ownerA, idOwnerA);
    const clientAdminA = await sessionFor(url, anonKey, admin, emails.adminA, idAdminA);
    const clientAgentA = await sessionFor(url, anonKey, admin, emails.agentA, idAgentA);
    const clientOwnerB = await sessionFor(url, anonKey, admin, emails.ownerB, idOwnerB);
    record('SETUP-SESSION', 'PASS', 'four disposable JWT sessions verified via getUser()');

    const organizationNameA = `Adapter Smoke OrgA ${runId}`;
    const organizationNameB = `Adapter Smoke OrgB ${runId}`;
    expectedOrganizationOwners.push(
      { userId: idOwnerA, organizationName: organizationNameA },
      { userId: idOwnerB, organizationName: organizationNameB },
    );
    // Until create RPC returns a confirmed organization_id, treat owners as unresolved.
    unresolvedOwnerUserIds.add(idOwnerA);
    unresolvedOwnerUserIds.add(idOwnerB);

    const createdA = await clientOwnerA.rpc('create_organization_with_owner', {
      p_name: organizationNameA,
    });
    const organizationIdA = extractOrganizationIdFromRpc(createdA.data, createdA.error);
    if (!organizationIdA) throw new Error('owner A organization create failed: invalid organization_id');
    orgAId = organizationIdA;
    ownerOrgByUserId.set(idOwnerA, [orgAId]);
    unresolvedOwnerUserIds.delete(idOwnerA);

    const createdB = await clientOwnerB.rpc('create_organization_with_owner', {
      p_name: organizationNameB,
    });
    const organizationIdB = extractOrganizationIdFromRpc(createdB.data, createdB.error);
    if (!organizationIdB) throw new Error('owner B organization create failed: invalid organization_id');
    orgBId = organizationIdB;
    ownerOrgByUserId.set(idOwnerB, [orgBId]);
    unresolvedOwnerUserIds.delete(idOwnerB);
    record('SETUP-ORG', 'PASS', 'two independent orgs via create_organization_with_owner');

    const memAdmin = await admin
      .from('organization_members')
      .insert({
        organization_id: orgAId,
        user_id: idAdminA,
        role: 'admin',
        status: 'active',
        joined_at: new Date().toISOString(),
      })
      .select('id, role, status')
      .single();
    if (memAdmin.error || memAdmin.data?.role !== 'admin') throw new Error('admin membership seed failed');

    const memAgent = await admin
      .from('organization_members')
      .insert({
        organization_id: orgAId,
        user_id: idAgentA,
        role: 'agent',
        status: 'active',
        joined_at: new Date().toISOString(),
      })
      .select('id, role, status')
      .single();
    if (memAgent.error || memAgent.data?.role !== 'agent') throw new Error('agent membership seed failed');
    record('SETUP-MEMBERSHIP', 'PASS', 'admin+agent membership rows provisioned via service role');

    for (const [label, client, expectedRole, expectedOrg] of [
      ['ownerA', clientOwnerA, 'owner', orgAId],
      ['adminA', clientAdminA, 'admin', orgAId],
      ['agentA', clientAgentA, 'agent', orgAId],
      ['ownerB', clientOwnerB, 'owner', orgBId],
    ] as const) {
      const m = await getCurrentMembership(client);
      if (!m || m.role !== expectedRole || m.organizationId !== expectedOrg) {
        record(
          `MEMBERSHIP-${label}`,
          'FAIL',
          `got role=${m?.role} org=${m?.organizationId?.slice(0, 8)}`,
        );
      } else {
        record(`MEMBERSHIP-${label}`, 'PASS', `role=${m.role}`);
      }
    }

    const ownerRepos = reposFor(clientOwnerA);
    const adminRepos = reposFor(clientAdminA);
    const agentRepos = reposFor(clientAgentA);
    const ownerBRepos = reposFor(clientOwnerB);

    // --- Properties CRUD ---
    const prop = await ownerRepos.properties.create({
      title: `آپارتمان تست ${runId}`,
      transactionType: 'sale',
      propertyType: 'apartment',
      area: 120,
      bedrooms: 3,
      location: 'تهران',
      neighborhood: 'سعادت‌آباد',
      price: 11_000_000_000,
      deposit: null,
      rent: null,
      floor: 5,
      totalFloors: 10,
      parking: true,
      elevator: true,
      storage: false,
      description: 'توضیحات آزمایشی',
      contactName: 'مالک آزمایشی',
      contactPhone: '09120000000',
    });
    record(
      'PROP-CREATE',
      prop.id && prop.price === 11_000_000_000 ? 'PASS' : 'FAIL',
      `id=${prop.id?.slice(0, 8)}`,
    );

    const propGot = await ownerRepos.properties.get(prop.id);
    record('PROP-GET', propGot?.id === prop.id ? 'PASS' : 'FAIL', '');

    const propList = await ownerRepos.properties.list();
    record('PROP-LIST', propList.some((p) => p.id === prop.id) ? 'PASS' : 'FAIL', `n=${propList.length}`);

    const propSearch = await ownerRepos.properties.search('سعادت');
    record(
      'PROP-SEARCH',
      propSearch.some((p) => p.id === prop.id) ? 'PASS' : 'FAIL',
      `n=${propSearch.length}`,
    );

    const propUpdated = await ownerRepos.properties.update(prop.id, {
      title: `آپارتمان به‌روز ${runId}`,
      price: 12_000_000_000,
    });
    record(
      'PROP-UPDATE',
      propUpdated.title.includes('به‌روز') && propUpdated.price === 12_000_000_000 ? 'PASS' : 'FAIL',
      '',
    );

    // --- Clients CRUD + search ---
    const clientRow = await ownerRepos.clients.create({
      name: `مشتری ${runId}`,
      phone: '09121112233',
      notes: 'یادداشت',
      tags: ['خریدار', 'فوری'],
    });
    record('CLIENT-CREATE', clientRow.id ? 'PASS' : 'FAIL', '');

    const clientGot = await ownerRepos.clients.get(clientRow.id);
    record('CLIENT-GET', clientGot?.id === clientRow.id ? 'PASS' : 'FAIL', '');

    const clientList = await ownerRepos.clients.list();
    record(
      'CLIENT-LIST',
      clientList.some((c) => c.id === clientRow.id) ? 'PASS' : 'FAIL',
      `n=${clientList.length}`,
    );

    const clientSearch = await ownerRepos.clients.search(runId);
    record(
      'CLIENT-SEARCH',
      clientSearch.some((c) => c.id === clientRow.id) ? 'PASS' : 'FAIL',
      `n=${clientSearch.length}`,
    );

    const clientUpdated = await ownerRepos.clients.update(clientRow.id, {
      notes: 'یادداشت به‌روز',
    });
    record('CLIENT-UPDATE', clientUpdated.notes === 'یادداشت به‌روز' ? 'PASS' : 'FAIL', '');

    // --- Needs CRUD ---
    const need = await ownerRepos.needs.create({
      clientId: clientRow.id,
      transactionType: 'sale',
      propertyType: 'apartment',
      minArea: 80,
      maxArea: 150,
      maxPrice: 15_000_000_000,
      maxDeposit: null,
      maxRent: null,
      bedrooms: 2,
      location: 'تهران',
      notes: 'نیاز آزمایشی',
    });
    record('NEED-CREATE', need.id && need.clientId === clientRow.id ? 'PASS' : 'FAIL', '');

    const needGot = await ownerRepos.needs.get(need.id);
    record('NEED-GET', needGot?.id === need.id ? 'PASS' : 'FAIL', '');

    const needList = await ownerRepos.needs.list();
    record('NEED-LIST', needList.some((n) => n.id === need.id) ? 'PASS' : 'FAIL', `n=${needList.length}`);

    const needsByClient = await ownerRepos.needs.listByClient(clientRow.id);
    record(
      'NEED-LIST-BY-CLIENT',
      needsByClient.some((n) => n.id === need.id) ? 'PASS' : 'FAIL',
      '',
    );

    const needUpdated = await ownerRepos.needs.update(need.id, { notes: 'نیاز به‌روز' });
    record('NEED-UPDATE', needUpdated.notes === 'نیاز به‌روز' ? 'PASS' : 'FAIL', '');

    // --- Follow-ups CRUD + setStatus ---
    const fu = await ownerRepos.followUps.create({
      clientId: clientRow.id,
      propertyId: prop.id,
      title: `پیگیری ${runId}`,
      dueDate: '2026-12-01',
      status: 'pending',
      notes: 'یادداشت پیگیری',
    });
    record('FU-CREATE', fu.id && fu.dueDate === '2026-12-01' ? 'PASS' : 'FAIL', `due=${fu.dueDate}`);

    const fuGot = await ownerRepos.followUps.get(fu.id);
    record('FU-GET', fuGot?.id === fu.id ? 'PASS' : 'FAIL', '');

    const fuList = await ownerRepos.followUps.list();
    record('FU-LIST', fuList.some((f) => f.id === fu.id) ? 'PASS' : 'FAIL', `n=${fuList.length}`);

    const fuByClient = await ownerRepos.followUps.listByClient(clientRow.id);
    record(
      'FU-LIST-BY-CLIENT',
      fuByClient.some((f) => f.id === fu.id) ? 'PASS' : 'FAIL',
      '',
    );

    const fuUpdated = await ownerRepos.followUps.update(fu.id, { notes: 'پیگیری به‌روز' });
    record('FU-UPDATE', fuUpdated.notes === 'پیگیری به‌روز' ? 'PASS' : 'FAIL', '');

    const fuStatus = await ownerRepos.followUps.setStatus(fu.id, 'completed');
    record('FU-SET-STATUS', fuStatus.status === 'completed' ? 'PASS' : 'FAIL', '');

    // Activities
    await ownerRepos.activities.log('client', `رویداد آزمایشی ${runId}`);
    const recent = await ownerRepos.activities.recent(10);
    record(
      'ACTIVITY-RECENT',
      recent.some((a) => a.text.includes(runId)) ? 'PASS' : 'FAIL',
      `n=${recent.length}`,
    );

    // Agent create/update own rows for all four tables
    const agentProp = await agentRepos.properties.create({
      title: `ملک Agent ${runId}`,
      transactionType: 'rent',
      propertyType: 'apartment',
      area: 65,
      bedrooms: 1,
      location: 'پونک',
      neighborhood: 'پونک',
      price: null,
      deposit: 300_000_000,
      rent: 9_000_000,
      floor: 2,
      totalFloors: 5,
      parking: false,
      elevator: true,
      storage: false,
      description: '',
      contactName: '',
      contactPhone: '',
    });
    record('AGENT-PROP-CREATE', agentProp.id ? 'PASS' : 'FAIL', '');
    const agentPropUp = await agentRepos.properties.update(agentProp.id, {
      description: 'ویرایش agent',
    });
    record('AGENT-PROP-UPDATE', agentPropUp.description === 'ویرایش agent' ? 'PASS' : 'FAIL', '');

    const agentClient = await agentRepos.clients.create({
      name: `مشتری Agent ${runId}`,
      phone: '09123334455',
      notes: '',
      tags: ['agent'],
    });
    record('AGENT-CLIENT-CREATE', agentClient.id ? 'PASS' : 'FAIL', '');
    const agentClientUp = await agentRepos.clients.update(agentClient.id, { notes: 'agent-note' });
    record('AGENT-CLIENT-UPDATE', agentClientUp.notes === 'agent-note' ? 'PASS' : 'FAIL', '');

    const agentNeed = await agentRepos.needs.create({
      clientId: agentClient.id,
      transactionType: 'rent',
      propertyType: 'apartment',
      minArea: 40,
      maxArea: 70,
      maxPrice: null,
      maxDeposit: 400_000_000,
      maxRent: 12_000_000,
      bedrooms: 1,
      location: 'پونک',
      notes: 'agent need',
    });
    record('AGENT-NEED-CREATE', agentNeed.id ? 'PASS' : 'FAIL', '');
    const agentNeedUp = await agentRepos.needs.update(agentNeed.id, { notes: 'agent need up' });
    record('AGENT-NEED-UPDATE', agentNeedUp.notes === 'agent need up' ? 'PASS' : 'FAIL', '');

    const agentFu = await agentRepos.followUps.create({
      clientId: agentClient.id,
      propertyId: agentProp.id,
      title: `پیگیری Agent ${runId}`,
      dueDate: '2026-12-15',
      status: 'pending',
      notes: '',
    });
    record('AGENT-FU-CREATE', agentFu.id ? 'PASS' : 'FAIL', '');
    const agentFuUp = await agentRepos.followUps.update(agentFu.id, { notes: 'agent fu up' });
    record('AGENT-FU-UPDATE', agentFuUp.notes === 'agent fu up' ? 'PASS' : 'FAIL', '');

    // Agent cannot delete own or owner rows (all four tables)
    await expectDeleteDenied('AGENT-DENY-OWN-PROP', agentRepos, 'properties', agentProp.id, ownerRepos);
    await expectDeleteDenied('AGENT-DENY-OWN-CLIENT', agentRepos, 'clients', agentClient.id, ownerRepos);
    await expectDeleteDenied('AGENT-DENY-OWN-NEED', agentRepos, 'needs', agentNeed.id, ownerRepos);
    await expectDeleteDenied('AGENT-DENY-OWN-FU', agentRepos, 'followUps', agentFu.id, ownerRepos);
    await expectDeleteDenied('AGENT-DENY-OWNER-PROP', agentRepos, 'properties', prop.id, ownerRepos);
    await expectDeleteDenied('AGENT-DENY-OWNER-CLIENT', agentRepos, 'clients', clientRow.id, ownerRepos);
    await expectDeleteDenied('AGENT-DENY-OWNER-NEED', agentRepos, 'needs', need.id, ownerRepos);
    await expectDeleteDenied('AGENT-DENY-OWNER-FU', agentRepos, 'followUps', fu.id, ownerRepos);

    // Independent Need / Follow-up deletes by Admin (not via client cascade)
    await expectDeleteAllowed(
      'ADMIN-DELETE-AGENT-NEED',
      adminRepos,
      'needs',
      agentNeed.id,
      ownerRepos,
    );
    await expectDeleteAllowed('ADMIN-DELETE-AGENT-FU', adminRepos, 'followUps', agentFu.id, ownerRepos);

    // Admin deletes agent property and client
    await expectDeleteAllowed(
      'ADMIN-DELETE-AGENT-PROP',
      adminRepos,
      'properties',
      agentProp.id,
      ownerRepos,
    );
    await expectDeleteAllowed(
      'ADMIN-DELETE-AGENT-CLIENT',
      adminRepos,
      'clients',
      agentClient.id,
      ownerRepos,
    );

    // Cross-tenant: Admin A cannot delete Org B data; Owner B still sees it
    const orgBClient = await ownerBRepos.clients.create({
      name: `OrgB Client ${runId}`,
      phone: '09120001111',
      notes: '',
      tags: [],
    });
    const orgBProp = await ownerBRepos.properties.create({
      title: `OrgB Prop ${runId}`,
      transactionType: 'sale',
      propertyType: 'other',
      area: null,
      bedrooms: null,
      location: 'مشهد',
      neighborhood: '',
      price: 1_000_000_000,
      deposit: null,
      rent: null,
      floor: null,
      totalFloors: null,
      parking: null,
      elevator: null,
      storage: null,
      description: '',
      contactName: '',
      contactPhone: '',
    });
    const orgBNeed = await ownerBRepos.needs.create({
      clientId: orgBClient.id,
      transactionType: 'sale',
      propertyType: 'other',
      minArea: null,
      maxArea: null,
      maxPrice: 2_000_000_000,
      maxDeposit: null,
      maxRent: null,
      bedrooms: null,
      location: 'مشهد',
      notes: '',
    });
    const orgBFu = await ownerBRepos.followUps.create({
      clientId: orgBClient.id,
      propertyId: orgBProp.id,
      title: `OrgB FU ${runId}`,
      dueDate: '2026-12-20',
      status: 'pending',
      notes: '',
    });

    await expectDeleteDenied(
      'ADMIN-DENY-ORGB-CLIENT',
      adminRepos,
      'clients',
      orgBClient.id,
      ownerBRepos,
    );
    await expectDeleteDenied(
      'ADMIN-DENY-ORGB-PROP',
      adminRepos,
      'properties',
      orgBProp.id,
      ownerBRepos,
    );
    await expectDeleteDenied('ADMIN-DENY-ORGB-NEED', adminRepos, 'needs', orgBNeed.id, ownerBRepos);
    await expectDeleteDenied('ADMIN-DENY-ORGB-FU', adminRepos, 'followUps', orgBFu.id, ownerBRepos);

    const stillBClient = await ownerBRepos.clients.get(orgBClient.id);
    const stillBProp = await ownerBRepos.properties.get(orgBProp.id);
    const stillBNeed = await ownerBRepos.needs.get(orgBNeed.id);
    const stillBFu = await ownerBRepos.followUps.get(orgBFu.id);
    record(
      'OWNERB-SEES-AFTER-ADMIN-DENY',
      stillBClient?.id === orgBClient.id &&
        stillBProp?.id === orgBProp.id &&
        stillBNeed?.id === orgBNeed.id &&
        stillBFu?.id === orgBFu.id
        ? 'PASS'
        : 'FAIL',
      '',
    );

    // Owner independent need/fu delete (before client cascade)
    const soloNeed = await ownerRepos.needs.create({
      clientId: clientRow.id,
      transactionType: 'sale',
      propertyType: 'apartment',
      minArea: 50,
      maxArea: 90,
      maxPrice: 5_000_000_000,
      maxDeposit: null,
      maxRent: null,
      bedrooms: 1,
      location: 'تهران',
      notes: 'solo need',
    });
    const soloFu = await ownerRepos.followUps.create({
      clientId: clientRow.id,
      propertyId: prop.id,
      title: `solo fu ${runId}`,
      dueDate: '2026-12-25',
      status: 'pending',
      notes: '',
    });
    await expectDeleteAllowed('OWNER-DELETE-NEED', ownerRepos, 'needs', soloNeed.id, ownerRepos);
    await expectDeleteAllowed('OWNER-DELETE-FU', ownerRepos, 'followUps', soloFu.id, ownerRepos);
    // original need/fu still present for cascade test
    const needStill = await ownerRepos.needs.get(need.id);
    const fuStill = await ownerRepos.followUps.get(fu.id);
    record(
      'OWNER-INDEPENDENT-DELETE-PRESERVES-OTHERS',
      needStill?.id === need.id && fuStill?.id === fu.id ? 'PASS' : 'FAIL',
      '',
    );

    // Owner client cascade (distinct from independent need/fu deletes)
    try {
      await ownerRepos.clients.remove(clientRow.id);
      const needGone = await ownerRepos.needs.get(need.id);
      const fuGone = await ownerRepos.followUps.get(fu.id);
      const clientGone = await ownerRepos.clients.get(clientRow.id);
      record(
        'OWNER-CLIENT-CASCADE',
        !needGone && !fuGone && !clientGone ? 'PASS' : 'FAIL',
        `need=${!!needGone} fu=${!!fuGone} client=${!!clientGone}`,
      );
    } catch (e) {
      const c = classifyDeleteDenial(e);
      record('OWNER-CLIENT-CASCADE', 'FAIL', `errName=${c.name} kind=${c.kind}`);
    }

    await expectDeleteAllowed('OWNER-DELETE-PROP', ownerRepos, 'properties', prop.id, ownerRepos);

    // Owner B cleanup of own org rows (authorized)
    await expectDeleteAllowed(
      'OWNERB-DELETE-FU',
      ownerBRepos,
      'followUps',
      orgBFu.id,
      ownerBRepos,
    );
    await expectDeleteAllowed(
      'OWNERB-DELETE-NEED',
      ownerBRepos,
      'needs',
      orgBNeed.id,
      ownerBRepos,
    );
    await expectDeleteAllowed(
      'OWNERB-DELETE-PROP',
      ownerBRepos,
      'properties',
      orgBProp.id,
      ownerBRepos,
    );
    await expectDeleteAllowed(
      'OWNERB-DELETE-CLIENT',
      ownerBRepos,
      'clients',
      orgBClient.id,
      ownerBRepos,
    );

    // Pagination seed 501 via service role, read via adapter JWT
    record(
      'PAGE-SIZE-CONST',
      SUPABASE_LIST_PAGE_SIZE === 500 ? 'PASS' : 'FAIL',
      String(SUPABASE_LIST_PAGE_SIZE),
    );
    const seedRows = [];
    for (let i = 0; i < 501; i++) {
      seedRows.push({
        organization_id: orgAId,
        title: `PageSeed ${runId} ${String(i).padStart(3, '0')}`,
        transaction_type: 'sale',
        property_type: 'other',
        location: 'seed',
        neighborhood: i === 500 ? `last-page-${runId}` : 'seed',
        description: '',
        contact_name: '',
        contact_phone: '',
        created_by: idOwnerA,
        updated_by: idOwnerA,
      });
    }
    const pageSeedIds: string[] = [];
    for (let i = 0; i < seedRows.length; i += 100) {
      const chunk = seedRows.slice(i, i + 100);
      const ins = await admin.from('properties').insert(chunk).select('id');
      if (ins.error || !ins.data) {
        throw new Error(`page seed insert failed at ${i}: ${ins.error?.code || 'unknown'}`);
      }
      for (const r of ins.data) pageSeedIds.push(r.id);
    }
    record('PAGE-SEED', pageSeedIds.length === 501 ? 'PASS' : 'FAIL', `n=${pageSeedIds.length}`);

    const allListed = await ownerRepos.properties.list();
    const seedListed = allListed.filter((p) => p.title.startsWith(`PageSeed ${runId}`));
    const uniqueIds = new Set(seedListed.map((p) => p.id));
    record(
      'PAGE-LIST-ADAPTER',
      seedListed.length === 501 && uniqueIds.size === 501 ? 'PASS' : 'FAIL',
      `n=${seedListed.length} unique=${uniqueIds.size}`,
    );
    const searchLast = await ownerRepos.properties.search(`last-page-${runId}`);
    record('PAGE-SEARCH-LAST', searchLast.length >= 1 ? 'PASS' : 'FAIL', `n=${searchLast.length}`);

    // Membership revoke for agent
    const revoked = await admin
      .from('organization_members')
      .update({ status: 'removed' })
      .eq('organization_id', orgAId)
      .eq('user_id', idAgentA)
      .select('id, status');
    if (revoked.error) throw new Error(`agent membership revoke failed: ${revoked.error.code}`);
    const mAfter = await getCurrentMembership(clientAgentA);
    record('MEMBERSHIP-REVOKED', mAfter === null ? 'PASS' : 'FAIL', `m=${mAfter?.role}`);
    let listThrew = false;
    try {
      await agentRepos.properties.list();
    } catch (e) {
      listThrew = isAuthError(e);
    }
    record('ADAPTER-FAIL-CLOSED-AFTER-REVOKE', listThrew ? 'PASS' : 'FAIL', '');
  } catch (e) {
    record('RUNNER-ERROR', 'FAIL', e instanceof Error ? e.message : String(e));
  } finally {
    // Recover resources whose create requests may have committed despite lost responses.
    let cleanupUserIds = [...userIds];
    try {
      cleanupUserIds = await discoverDisposableUserIds(
        admin,
        uncertainCreateEmails,
        runId,
        userIds,
        cleanupFailures,
      );
    } catch {
      cleanupFailures.push('user-discovery:unexpected');
    }

    const knownOrganizationIds = [orgAId, orgBId].filter((id): id is string => id !== null);
    let cleanupOrganizationIds = knownOrganizationIds;
    try {
      const discovery = await discoverOrganizationIds(
        admin,
        expectedOrganizationOwners,
        knownOrganizationIds,
        cleanupFailures,
      );
      cleanupOrganizationIds = discovery.organizationIds;
      // Apply only exact recovered owner→org links; never invent ownership.
      for (const [ownerId, orgIds] of discovery.ownerOrgLinks) {
        const merged = [...(ownerOrgByUserId.get(ownerId) ?? [])];
        for (const orgId of orgIds) {
          if (!merged.includes(orgId)) merged.push(orgId);
        }
        ownerOrgByUserId.set(ownerId, merged);
      }
      // Per-user unresolved resolution (production helper). Residual org
      // protection and residualOrgIds remain unchanged downstream.
      resolveUnresolvedOwnersAfterDiscovery({
        expectedOwnerUserIds: expectedOrganizationOwners.map((e) => e.userId),
        ownerOrgByUserId,
        unresolvedOwnerUserIds,
        hadErrors: discovery.hadErrors,
        ownersWithNoMemberships: discovery.ownersWithNoMemberships,
      });
    } catch {
      cleanupFailures.push('org-discovery:unexpected');
      for (const exp of expectedOrganizationOwners) {
        unresolvedOwnerUserIds.add(exp.userId);
      }
    }

    // Cleanup: each request is independently guarded; failures accumulate; continue other resources.
    const bizTables = BUSINESS_CLEANUP_TABLES;
    for (const orgId of cleanupOrganizationIds) {
      for (const table of bizTables) {
        await checkedDelete(admin, table, 'organization_id', orgId, cleanupFailures, `biz:${table}`);
      }
      try {
        const memDel = await admin
          .from('organization_members')
          .delete()
          .eq('organization_id', orgId)
          .select('id');
        if (memDel.error) cleanupFailures.push(`members:${memDel.error.code || 'error'}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        cleanupFailures.push(`members:exception:${msg.slice(0, 80)}`);
      }

      try {
        const orgDel = await admin.from('organizations').delete().eq('id', orgId).select('id');
        if (orgDel.error) cleanupFailures.push(`org-del:${orgDel.error.code || 'error'}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        cleanupFailures.push(`org-del:exception:${msg.slice(0, 80)}`);
      }
    }

    // Read-back orgs + memberships BEFORE any Auth user delete (fail-closed residual set).
    const residualOrgIds = new Set<string>();
    for (const orgId of cleanupOrganizationIds) {
      const label =
        orgId === orgAId ? 'orgA' : orgId === orgBId ? 'orgB' : `recovered-org-${orgId.slice(0, 8)}`;
      try {
        const orgChk = await admin.from('organizations').select('id').eq('id', orgId).maybeSingle();
        const orgOutcome = classifyMaybeSingleRead(orgChk.data, orgChk.error);
        if (orgOutcome === 'error') {
          cleanupFailures.push(`${label}-org-read:${orgChk.error?.code || 'error'}`);
          residualOrgIds.add(orgId);
        } else if (orgOutcome === 'present') {
          cleanupFailures.push(`${label}-still-present`);
          residualOrgIds.add(orgId);
        } else if (orgOutcome === 'ambiguous') {
          cleanupFailures.push(`${label}-org-read-ambiguous`);
          residualOrgIds.add(orgId);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        cleanupFailures.push(`${label}-org-read:exception:${msg.slice(0, 80)}`);
        residualOrgIds.add(orgId);
      }

      try {
        const memChk = await admin
          .from('organization_members')
          .select('id')
          .eq('organization_id', orgId);
        const memOutcome = classifyListRead(memChk.data, memChk.error);
        if (memOutcome === 'error') {
          cleanupFailures.push(`${label}-mem-read:${memChk.error?.code || 'error'}`);
          residualOrgIds.add(orgId);
        } else if (memOutcome === 'ambiguous') {
          cleanupFailures.push(`${label}-mem-read-ambiguous`);
          residualOrgIds.add(orgId);
        } else if (memOutcome === 'present') {
          cleanupFailures.push(`${label}-members-remain`);
          residualOrgIds.add(orgId);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        cleanupFailures.push(`${label}-mem-read:exception:${msg.slice(0, 80)}`);
        residualOrgIds.add(orgId);
      }

      await accumulateBusinessTableResiduals({
        organizationIds: [orgId],
        labelForOrg: () => label,
        residualOrgIds,
        cleanupFailures,
        readTable: async (tableOrgId, table) => {
          const rowChk = await admin
            .from(table)
            .select('id')
            .eq('organization_id', tableOrgId)
            .limit(1);
          return { data: rowChk.data, error: rowChk.error };
        },
      });
    }

    // Per-user membership check + owner-protection gate via injectable production path.
    const { skippedUserIds } = await deleteDisposableUsersWithOwnerGate({
      cleanupUserIds,
      ownerOrgByUserId,
      unresolvedOwnerUserIds,
      residualOrgIds,
      cleanupFailures,
      listMembershipsByUserId: async (uid) => {
        const memByUser = await admin
          .from('organization_members')
          .select('id')
          .eq('user_id', uid);
        return { data: memByUser.data, error: memByUser.error };
      },
      deleteUser: async (uid) => {
        const del = await admin.auth.admin.deleteUser(uid);
        return { error: del.error };
      },
    });

    // User read-back: only attempted deletes must be absent; retained owners stay present.
    for (const uid of cleanupUserIds) {
      const skipReason = skippedUserIds.get(uid);
      try {
        const u = await admin.auth.admin.getUserById(uid);
        if (u.data?.user?.id) {
          if (skipReason) {
            // Intentionally retained — not a false success path; skip already recorded.
            continue;
          }
          cleanupFailures.push(`user-still:${uid.slice(0, 8)}`);
          continue;
        }
        if (u.error) {
          const code = String((u.error as { code?: string }).code || '').toLowerCase();
          const status = Number((u.error as { status?: number }).status || 0);
          const msg = String(u.error.message || '').toLowerCase();
          const definitiveAbsent =
            status === 404 ||
            code === 'user_not_found' ||
            code === 'not_found' ||
            msg.includes('user not found');
          if (skipReason) {
            // Gate blocked delete but user is already gone — acceptable; no extra failure.
            continue;
          }
          if (!definitiveAbsent) {
            cleanupFailures.push(
              `user-verify:${uid.slice(0, 8)}:${u.error.code || u.error.message || 'error'}`,
            );
          }
          continue;
        }
        if (skipReason) continue;
        // No error but no user id: ambiguous response — must FAIL cleanup.
        cleanupFailures.push(`user-verify-ambiguous:${uid.slice(0, 8)}`);
      } catch (e) {
        if (skipReason) continue;
        const msg = e instanceof Error ? e.message : String(e);
        cleanupFailures.push(`user-verify-ex:${uid.slice(0, 8)}:${msg.slice(0, 80)}`);
      }
    }

    const cleanupStatus = cleanupStatusFromFailures(cleanupFailures);
    if (cleanupStatus === 'PASS') {
      record('CLEANUP', 'PASS', `run_id=${runId} orgs+members+users verified absent`);
    } else {
      record(
        'CLEANUP',
        'FAIL',
        `run_id=${runId} failures=${cleanupFailures.join(',')}`,
      );
    }
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  console.log(`\nSUMMARY passed=${passed} failed=${failed} skipped=${skipped} run_id=${runId}`);
  if (runnerShouldExitNonZero(results, cleanupFailures)) {
    process.exit(1);
  }
}
