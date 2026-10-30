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
 * Rejects missing, empty, duplicate, short, or non-alphanumeric tokens.
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
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  if (raw.includes('://')) return '/';

  let current = raw;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round++) {
    if (pathCarriesInviteToken(current)) return '/';

    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      // Malformed percent-encoding is not a usable redirect target.
      return '/';
    }
    if (decoded === current) break;
    current = decoded;
  }

  if (pathCarriesInviteToken(current)) return '/';
  return raw;
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
