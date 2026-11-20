/**
 * Fail-closed owner-protection gate helpers for Staging adapter smoke cleanup.
 * Pure functions — no Supabase or network dependencies.
 */

/** Outcome of a cleanup read used by the owner-protection gate. */
export type CleanupReadOutcome = 'absent' | 'present' | 'error' | 'ambiguous';


/**
 * Read the organization_id returned by create_organization_with_owner.
 * PostgREST table-returning RPCs normally return one row in an array; tolerate
 * a single object for compatible clients, but reject zero/multiple rows and
 * every malformed or blank identifier. This is a runtime guard, not a cast.
 */
export function extractOrganizationIdFromRpc(data: unknown, error: unknown): string | null {
  if (error !== null && error !== undefined) return null;

  let row: unknown = data;
  if (Array.isArray(data)) {
    if (data.length !== 1) return null;
    row = data[0];
  }

  if (row === null || typeof row !== 'object' || Array.isArray(row)) return null;
  const organizationId = (row as { organization_id?: unknown }).organization_id;
  if (typeof organizationId !== 'string') return null;
  if (organizationId.trim().length === 0 || organizationId !== organizationId.trim()) return null;
  return organizationId;
}

/**
 * Classify a list-shaped PostgREST read. Only a real array with no error is trusted.
 * null/undefined/non-array without error is ambiguous (fail-closed).
 */
export function classifyListRead(
  data: unknown,
  error: { code?: string; message?: string } | null | undefined,
): CleanupReadOutcome {
  if (error) return 'error';
  if (!Array.isArray(data)) return 'ambiguous';
  return data.length === 0 ? 'absent' : 'present';
}

/**
 * Classify a maybeSingle org read. Present requires a non-empty string id.
 */
export function classifyMaybeSingleRead(
  data: { id?: unknown } | null | undefined,
  error: { code?: string; message?: string } | null | undefined,
): CleanupReadOutcome {
  if (error) return 'error';
  if (data === null) return 'absent';
  if (data === undefined || typeof data !== 'object') return 'ambiguous';
  const id = data.id;
  if (typeof id !== 'string' || id.length === 0) return 'ambiguous';
  return 'present';
}

/**
 * Gate disposable Auth user delete. Returns a skip reason, or null when delete is allowed.
 * relatedOrgIds is only populated for confirmed owners of this run; non-owners pass [].
 * membershipOutcome must come from a per-user_id membership list read.
 * Fail-closed: any residual org, membership presence/error/ambiguous, or unresolved
 * owner link blocks deleteUser.
 */
export function shouldSkipDisposableUserDelete(args: {
  relatedOrgIds: readonly string[];
  residualOrgIds: ReadonlySet<string>;
  membershipOutcome: CleanupReadOutcome;
  membershipErrorCode?: string;
  /** True when this disposable user is an owner whose org link is not fully proven. */
  ownerUnresolved?: boolean;
}): string | null {
  // Membership absence never clears an unresolved owner.
  if (args.ownerUnresolved) return 'owner-org-unresolved';
  for (const orgId of args.relatedOrgIds) {
    if (args.residualOrgIds.has(orgId)) return 'org-residual';
  }
  if (args.membershipOutcome === 'present') return 'members-remain';
  if (args.membershipOutcome === 'error') {
    return `mem-read:${args.membershipErrorCode || 'error'}`;
  }
  if (args.membershipOutcome === 'ambiguous') return 'mem-read-ambiguous';
  return null;
}

/**
 * Classify a successful membership list payload (array only).
 * - Empty array is valid and proves zero memberships for every requested user.
 * - Non-empty: every row must be an object with a non-empty string user_id that
 *   belongs to the requested set. Any malformed row or unexpected user_id makes
 *   the whole result ambiguous (fail-closed).
 * Returns null when ambiguous; otherwise the set of user_ids that appear.
 */
export function classifyMembershipListRows(
  requestedUserIds: readonly string[],
  memberships: ReadonlyArray<unknown>,
): { presentUserIds: Set<string> } | null {
  const requested = new Set(requestedUserIds);
  const present = new Set<string>();
  for (const row of memberships) {
    if (row === null || typeof row !== 'object') return null;
    const uid = (row as { user_id?: unknown }).user_id;
    if (typeof uid !== 'string' || uid.length === 0) return null;
    if (!requested.has(uid)) return null;
    present.add(uid);
  }
  return { presentUserIds: present };
}

/** Pure helper: user_ids with zero membership rows after a valid classification. */
export function ownersWithZeroMembershipRows(
  userIds: readonly string[],
  presentUserIds: ReadonlySet<string>,
): Set<string> {
  const empty = new Set<string>();
  for (const uid of userIds) {
    if (!presentUserIds.has(uid)) empty.add(uid);
  }
  return empty;
}

/**
 * Production finally-path helper: update unresolvedOwnerUserIds after org discovery.
 * - Confirmed owner→org links clear unresolved for those owners.
 * - On hadErrors: expected owners without a confirmed link stay unresolved.
 * - On success: only owners proven to have zero membership rows are cleared;
 *   any unexpected membership (or name mismatch leaving no link) keeps unresolved.
 * Mutates unresolvedOwnerUserIds in place; returns it for convenience.
 */
export function resolveUnresolvedOwnersAfterDiscovery(args: {
  expectedOwnerUserIds: readonly string[];
  ownerOrgByUserId: ReadonlyMap<string, readonly string[]>;
  unresolvedOwnerUserIds: Set<string>;
  hadErrors: boolean;
  ownersWithNoMemberships: ReadonlySet<string>;
}): Set<string> {
  const unresolved = args.unresolvedOwnerUserIds;
  for (const [ownerId, orgIds] of args.ownerOrgByUserId) {
    if (orgIds.length > 0) unresolved.delete(ownerId);
  }
  if (args.hadErrors) {
    for (const uid of args.expectedOwnerUserIds) {
      const known = args.ownerOrgByUserId.get(uid) ?? [];
      if (known.length === 0) unresolved.add(uid);
    }
  } else {
    for (const uid of args.expectedOwnerUserIds) {
      const known = args.ownerOrgByUserId.get(uid) ?? [];
      if (known.length > 0) continue;
      if (args.ownersWithNoMemberships.has(uid)) {
        unresolved.delete(uid);
      } else {
        unresolved.add(uid);
      }
    }
  }
  return unresolved;
}
