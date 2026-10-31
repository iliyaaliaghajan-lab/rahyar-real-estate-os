/**
 * Unit tests for invitation URL helpers (fragment transport, legacy rejection, safe next).
 * Does not connect to Supabase or log any token values.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildInviteAcceptUrl,
  parseInviteTokenFromHash,
  hasLegacyTokenQuery,
  safeNextPath,
} from '../src/lib/auth/inviteUrl';

const SAMPLE =
  'a1b2c3d4e5f6789012345678abcdef01a1b2c3d4e5f6789012345678abcdef01'; // 64 hex chars

/** Encode a string N times with encodeURIComponent. */
function encodeTimes(value: string, times: number): string {
  let out = value;
  for (let i = 0; i < times; i++) {
    out = encodeURIComponent(out);
  }
  return out;
}

describe('buildInviteAcceptUrl', () => {
  it('places token only in the fragment and never in the query', () => {
    const url = buildInviteAcceptUrl('https://example.com', SAMPLE);
    assert.equal(url, `https://example.com/invite/accept#token=${SAMPLE}`);
    assert.ok(!url.includes('?token='));
    assert.ok(url.includes('#token='));
  });

  it('strips a trailing slash from origin', () => {
    const url = buildInviteAcceptUrl('https://example.com/', SAMPLE);
    assert.equal(url, `https://example.com/invite/accept#token=${SAMPLE}`);
  });

  it('URI-encodes the token in the fragment', () => {
    const url = buildInviteAcceptUrl('https://example.com', SAMPLE);
    assert.match(url, /#token=[A-Za-z0-9%]+$/);
  });
});

describe('parseInviteTokenFromHash', () => {
  it('extracts a valid fragment token', () => {
    const r = parseInviteTokenFromHash(`#token=${SAMPLE}`);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.token, SAMPLE);
  });

  it('accepts hash without leading #', () => {
    const r = parseInviteTokenFromHash(`token=${SAMPLE}`);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.token, SAMPLE);
  });

  it('rejects additional fragment parameters (canonical link is only token)', () => {
    const r = parseInviteTokenFromHash(`#token=${SAMPLE}&src=invite`);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'malformed');
  });

  it('rejects missing token', () => {
    assert.equal(parseInviteTokenFromHash('').ok, false);
    assert.equal(parseInviteTokenFromHash('#').ok, false);
    assert.equal(parseInviteTokenFromHash('#foo=bar').ok, false);
    const r = parseInviteTokenFromHash('#foo=bar');
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'malformed');
  });

  it('rejects short tokens', () => {
    const r = parseInviteTokenFromHash('#token=abcd');
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'too_short');
  });

  it('rejects malformed (non-alphanumeric) tokens', () => {
    const longBad = 'x'.repeat(40) + '!@#';
    const r = parseInviteTokenFromHash(`#token=${encodeURIComponent(longBad)}`);
    assert.equal(r.ok, false);
  });

  it('rejects duplicate token parameters in the fragment', () => {
    const r = parseInviteTokenFromHash(`#token=${SAMPLE}&token=${SAMPLE}`);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'duplicate');
  });

  it('rejects empty token values', () => {
    const r = parseInviteTokenFromHash('#token=');
    assert.equal(r.ok, false);
  });
});

describe('hasLegacyTokenQuery', () => {
  it('detects legacy ?token= without exposing the value', () => {
    assert.equal(hasLegacyTokenQuery(`?token=${SAMPLE}`), true);
    assert.equal(hasLegacyTokenQuery(`token=${SAMPLE}`), true);
    assert.equal(hasLegacyTokenQuery(`?foo=1&token=${SAMPLE}`), true);
  });

  it('returns false when no token query key is present', () => {
    assert.equal(hasLegacyTokenQuery(''), false);
    assert.equal(hasLegacyTokenQuery('?'), false);
    assert.equal(hasLegacyTokenQuery('?foo=bar'), false);
    assert.equal(hasLegacyTokenQuery('?tokenize=1'), false);
  });
});

describe('safeNextPath', () => {
  it('allows normal same-origin relative paths', () => {
    assert.equal(safeNextPath('/'), '/');
    assert.equal(safeNextPath('/team'), '/team');
    assert.equal(safeNextPath('/invite/accept'), '/invite/accept');
    assert.equal(safeNextPath('/dashboard?tab=1'), '/dashboard?tab=1');
  });

  it('blocks open redirects', () => {
    assert.equal(safeNextPath('https://evil.example/'), '/');
    assert.equal(safeNextPath('//evil.example'), '/');
    assert.equal(safeNextPath('http://evil'), '/');
    assert.equal(safeNextPath(null), '/');
    assert.equal(safeNextPath(undefined), '/');
  });

  it('rejects next paths that carry a query token', () => {
    assert.equal(safeNextPath(`/invite/accept?token=${SAMPLE}`), '/');
    assert.equal(safeNextPath(`/x?token=${SAMPLE}`), '/');
  });

  it('rejects next paths that carry a fragment token', () => {
    assert.equal(safeNextPath(`/invite/accept#token=${SAMPLE}`), '/');
  });

  it('rejects single-encoded token-bearing paths', () => {
    const once = encodeURIComponent(`/invite/accept?token=${SAMPLE}`);
    assert.equal(safeNextPath(`/${once}`), '/');
    assert.equal(
      safeNextPath(`/invite/accept?token=${encodeURIComponent(SAMPLE)}`),
      '/',
    );
    assert.equal(safeNextPath(`/invite/accept%3Ftoken%3D${SAMPLE}`), '/');
  });

  it('rejects double-encoded token-bearing paths (bounded decode)', () => {
    const double = encodeURIComponent(encodeURIComponent(`/invite/accept?token=${SAMPLE}`));
    assert.equal(safeNextPath(`/${double}`), '/');
    assert.equal(safeNextPath(`/invite/accept%253Ftoken%253D${SAMPLE}`), '/');
  });

  it('rejects token-bearing paths encoded four, five, and six times (fail closed past bound)', () => {
    const target = `/invite/accept?token=${SAMPLE}`;
    for (const times of [4, 5, 6]) {
      const encoded = encodeTimes(target, times);
      assert.equal(safeNextPath(`/${encoded}`), '/', `expected reject after ${times} encodings`);
      assert.equal(safeNextPath(encoded.startsWith('/') ? encoded : `/${encoded}`), '/');
    }
  });

  it('rejects encoded protocol-relative destinations', () => {
    assert.equal(safeNextPath(`/${encodeURIComponent('//evil.example')}`), '/');
    assert.equal(safeNextPath(`/${encodeTimes('//evil.example/phish', 2)}`), '/');
    assert.equal(safeNextPath(`/${encodeTimes('//evil.example', 3)}`), '/');
  });

  it('rejects nested next values that smuggle a token', () => {
    const nested = encodeURIComponent(`/invite/accept?token=${SAMPLE}`);
    assert.equal(safeNextPath(nested.startsWith('/') ? nested : `/${nested}`), '/');
  });

  it('rejects malformed percent-encoding rather than forwarding it', () => {
    assert.equal(safeNextPath('/invite/%E0%A4%A'), '/');
  });

  it('does not treat unrelated query keys as tokens', () => {
    assert.equal(safeNextPath('/team?view=members'), '/team?view=members');
  });
});

describe('accept page Strict Mode capture (static contract)', () => {
  const acceptSrc = readFileSync(
    join(process.cwd(), 'src/app/invite/accept/page.tsx'),
    'utf8',
  );

  it('stores capture outcome in a ref so Strict Mode replay can still use the token', () => {
    assert.match(acceptSrc, /useRef/);
    assert.match(acceptSrc, /captureRef/);
    assert.match(acceptSrc, /kind: 'ready'/);
    assert.match(acceptSrc, /kind: 'unset'/);
    assert.match(acceptSrc, /captureRef\.current\.kind === 'unset'/);
    assert.match(acceptSrc, /history\.replaceState/);
    assert.doesNotMatch(acceptSrc, /localStorage/);
    assert.doesNotMatch(acceptSrc, /sessionStorage/);
  });

  it('does not read the token from searchParams', () => {
    assert.doesNotMatch(acceptSrc, /searchParams\.get\(\s*['"]token['"]\s*\)/);
  });
});
