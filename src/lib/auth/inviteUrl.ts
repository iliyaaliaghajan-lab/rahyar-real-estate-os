/**
 * Invitation URL helpers — keep raw tokens out of query strings and redirects.
 *
 * Shareable links use a URL fragment (#token=…) so the token is not sent in the
 * initial HTTP request. Client code must clear the fragment immediately after
 * reading it. No browser web storage handoff is used.
 */

export type ParseInviteTokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'missing' | 'malformed' | 'too_short' | 'duplicate' };

const MIN_TOKEN_LENGTH = 32;
/** Bound decode loops so attackers cannot force unbounded work. */
const MAX_DECODE_ROUNDS = 3;

/** Build the shareable accept URL. Token is placed only in the fragment. */
export function buildInviteAcceptUrl(origin: string, token: string): string {
  const base = origin.replace(/\/$/, '');
  return `${base}/invite/accept#token=${encodeURIComponent(token)}`;
}

/**
 * Parse a single invitation token from a URL hash (with or without leading #).
 * Accepts exactly one fragment parameter named "token". Rejects extra keys,
 * duplicates, empty/short/malformed values.
 */
export function parseInviteTokenFromHash(hash: string): ParseInviteTokenResult {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw || !raw.trim()) {
    return { ok: false, reason: 'missing' };
  }

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  // Canonical link is only `#token=…` — reject any additional fragment keys.
  const keys = [...params.keys()];
  if (keys.length === 0) {
    return { ok: false, reason: 'missing' };
  }
  if (keys.some((k) => k !== 'token')) {
    return { ok: false, reason: 'malformed' };
  }
  if (keys.length > 1) {
    // Multiple `token` entries (duplicate keys).
    return { ok: false, reason: 'duplicate' };
  }

  const values = params.getAll('token');
  if (values.length === 0) {
    return { ok: false, reason: 'missing' };
  }
  if (values.length > 1) {
    return { ok: false, reason: 'duplicate' };
  }

  const token = (values[0] ?? '').trim();
  if (!token) {
    return { ok: false, reason: 'missing' };
  }
  if (token.length < MIN_TOKEN_LENGTH) {
    return { ok: false, reason: 'too_short' };
  }
  // Invitation tokens are hex (uuid concat without dashes); reject other shapes.
  if (!/^[A-Za-z0-9]+$/.test(token)) {
    return { ok: false, reason: 'malformed' };
  }

  return { ok: true, token };
}

/**
 * Detect a legacy ?token= query parameter without reading or returning its value.
 * Used only to reject old shareable links and force re-issue.
 */
export function hasLegacyTokenQuery(search: string): boolean {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (!raw) return false;
  try {
    const params = new URLSearchParams(raw);
    return params.getAll('token').length > 0;
  } catch {
    return /(?:^|&)token=/i.test(raw);
  }
}

/**
 * Same-origin relative path guard for login / auth callback `next` parameters.
 * Blocks open redirects and any path that would carry an invitation token in
 * query or fragment, including bounded multi-level URI decoding.
 * If the path is still further-decodable after the max rounds, reject (fail closed).
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return '/';
  if (!isSafeRelativePath(raw)) return '/';
  if (pathCarriesInviteToken(raw)) return '/';

  let current = raw;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      // Malformed percent-encoding is not a usable redirect target.
      return '/';
    }
    if (decoded === current) {
      // Fully decoded within the bound.
      if (!isSafeRelativePath(current) || pathCarriesInviteToken(current)) return '/';
      return raw;
    }

    current = decoded;
    // Re-check after every decode step.
    if (!isSafeRelativePath(current) || pathCarriesInviteToken(current)) return '/';
  }

  // Max rounds reached — if the string can still be decoded further, fail closed.
  try {
    const further = decodeURIComponent(current);
    if (further !== current) return '/';
  } catch {
    return '/';
  }

  if (!isSafeRelativePath(current) || pathCarriesInviteToken(current)) return '/';
  return raw;
}

/** Same-origin relative path: starts with single `/`, no scheme, not protocol-relative. */
function isSafeRelativePath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  if (path.includes('://')) return false;
  return true;
}

function pathCarriesInviteToken(path: string): boolean {
  // Fast path: literal query/fragment key.
  if (/[?#&]token=/i.test(path)) return true;

  // Structured parse against a fixed base (path may be relative).
  try {
    const u = new URL(path, 'http://local.invalid');
    if (u.searchParams.getAll('token').length > 0) return true;
    if (u.hash) {
      const hashBody = u.hash.startsWith('#') ? u.hash.slice(1) : u.hash;
      const hp = new URLSearchParams(hashBody);
      if (hp.getAll('token').length > 0) return true;
    }
  } catch {
    // Fall through — regex already checked.
  }

  return false;
}
