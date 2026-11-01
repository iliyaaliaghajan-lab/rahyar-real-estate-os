/**
 * Local unit tests for Supabase SSR cookie adapters (getAll / setAll).
 * Uses in-memory doubles only. Does not connect to hosted Supabase or
 * exercise live Auth token refresh.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CookieOptions } from '@supabase/ssr';

type CookieRecord = { name: string; value: string; options?: CookieOptions };

/** Minimal cookie jar used to exercise getAll / setAll contracts. */
function createCookieJar(initial: CookieRecord[] = []) {
  const store = new Map<string, CookieRecord>();
  for (const c of initial) {
    store.set(c.name, { ...c });
  }

  return {
    getAll(): { name: string; value: string }[] {
      return Array.from(store.values()).map(({ name, value }) => ({ name, value }));
    },
    set(name: string, value: string, options?: CookieOptions) {
      store.set(name, { name, value, options });
    },
    /** Simulate Server Component write failure when flag is set. */
    setThrowing(name: string, value: string, options?: CookieOptions) {
      throw new Error('Cookies can only be modified in a Server Action or Route Handler.');
    },
    snapshot(): CookieRecord[] {
      return Array.from(store.values()).map((c) => ({ ...c, options: c.options ? { ...c.options } : undefined }));
    },
  };
}

describe('server cookie adapter (getAll / setAll)', () => {
  it('reads multiple incoming cookies via getAll', () => {
    const jar = createCookieJar([
      { name: 'sb-access-token', value: 'chunk-a' },
      { name: 'sb-access-token.0', value: 'chunk-b' },
      { name: 'other', value: 'keep' },
    ]);

    const cookies = {
      getAll() {
        return jar.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value, options }) => jar.set(name, value, options));
      },
    };

    const all = cookies.getAll();
    assert.equal(all.length, 3);
    assert.deepEqual(
      all.map((c) => c.name).sort(),
      ['other', 'sb-access-token', 'sb-access-token.0']
    );
  });

  it('writes every cookie returned by setAll and preserves options', () => {
    const jar = createCookieJar();
    const cookies = {
      getAll() {
        return jar.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value, options }) => jar.set(name, value, options));
      },
    };

    const optionsA: CookieOptions = { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 3600 };
    const optionsB: CookieOptions = { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 };

    cookies.setAll([
      { name: 'sb-access-token', value: 'new-value', options: optionsA },
      { name: 'sb-access-token.1', value: '', options: optionsB },
    ]);

    const snap = jar.snapshot();
    assert.equal(snap.length, 2);

    const token = snap.find((c) => c.name === 'sb-access-token');
    assert.ok(token);
    assert.equal(token!.value, 'new-value');
    assert.equal(token!.options?.path, '/');
    assert.equal(token!.options?.httpOnly, true);
    assert.equal(token!.options?.sameSite, 'lax');
    assert.equal(token!.options?.maxAge, 3600);

    const cleared = snap.find((c) => c.name === 'sb-access-token.1');
    assert.ok(cleared);
    assert.equal(cleared!.value, '');
    assert.equal(cleared!.options?.maxAge, 0);
  });

  it('clears stale cookie chunks when setAll supplies empty values', () => {
    const jar = createCookieJar([
      { name: 'sb-access-token', value: 'old-0' },
      { name: 'sb-access-token.0', value: 'old-1' },
      { name: 'sb-access-token.1', value: 'old-2' },
    ]);

    const cookies = {
      getAll() {
        return jar.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value, options }) => jar.set(name, value, options));
      },
    };

    // Simulate chunk reduction: keep base, clear extras.
    cookies.setAll([
      { name: 'sb-access-token', value: 'compact', options: { path: '/', maxAge: 400 * 24 * 60 * 60 } },
      { name: 'sb-access-token.0', value: '', options: { path: '/', maxAge: 0 } },
      { name: 'sb-access-token.1', value: '', options: { path: '/', maxAge: 0 } },
    ]);

    const byName = Object.fromEntries(jar.snapshot().map((c) => [c.name, c]));
    assert.equal(byName['sb-access-token'].value, 'compact');
    assert.equal(byName['sb-access-token.0'].value, '');
    assert.equal(byName['sb-access-token.0'].options?.maxAge, 0);
    assert.equal(byName['sb-access-token.1'].value, '');
    assert.equal(byName['sb-access-token.1'].options?.maxAge, 0);
  });

  it('swallows Server Component write errors in setAll (safe no-op)', () => {
    const jar = createCookieJar();
    let threw = false;
    const cookies = {
      getAll() {
        return jar.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => jar.setThrowing(name, value, options));
        } catch {
          threw = true;
          // Expected when called from a Server Component.
        }
      },
    };

    assert.doesNotThrow(() => {
      cookies.setAll([
        { name: 'sb-access-token', value: 'x', options: { path: '/' } },
      ]);
    });
    assert.equal(threw, true);
    assert.equal(jar.getAll().length, 0);
  });
});

describe('middleware cookie adapter (getAll / setAll)', () => {
  it('reads all request cookies and applies setAll to both request and response jars', () => {
    const requestJar = createCookieJar([
      { name: 'sb-access-token', value: 'incoming' },
      { name: 'sb-access-token.0', value: 'chunk' },
    ]);
    const responseJar = createCookieJar();

    // Mirrors the middleware pattern: update request, rebuild response, set every cookie.
    const cookies = {
      getAll() {
        return requestJar.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => requestJar.set(name, value));
        // Rebuild response jar from scratch (simulates NextResponse.next rebuild).
        responseJar.getAll().forEach(() => {}); // no-op clear not needed; we only set
        cookiesToSet.forEach(({ name, value, options }) =>
          responseJar.set(name, value, options)
        );
      },
    };

    assert.equal(cookies.getAll().length, 2);

    const opts: CookieOptions = { path: '/', httpOnly: true, sameSite: 'lax' };
    cookies.setAll([
      { name: 'sb-access-token', value: 'refreshed', options: opts },
      { name: 'sb-access-token.0', value: '', options: { ...opts, maxAge: 0 } },
      { name: 'sb-new-chunk', value: 'extra', options: opts },
    ]);

    // Request must see updated values.
    const req = Object.fromEntries(requestJar.getAll().map((c) => [c.name, c.value]));
    assert.equal(req['sb-access-token'], 'refreshed');
    assert.equal(req['sb-access-token.0'], '');
    assert.equal(req['sb-new-chunk'], 'extra');

    // Response must carry every cookie with options (none lost on rebuild).
    const resSnap = responseJar.snapshot();
    assert.equal(resSnap.length, 3);
    const resToken = resSnap.find((c) => c.name === 'sb-access-token');
    assert.ok(resToken);
    assert.equal(resToken!.value, 'refreshed');
    assert.equal(resToken!.options?.httpOnly, true);
    assert.equal(resToken!.options?.path, '/');

    const cleared = resSnap.find((c) => c.name === 'sb-access-token.0');
    assert.ok(cleared);
    assert.equal(cleared!.value, '');
    assert.equal(cleared!.options?.maxAge, 0);

    const extra = resSnap.find((c) => c.name === 'sb-new-chunk');
    assert.ok(extra);
    assert.equal(extra!.value, 'extra');
  });

  it('does not drop cookies when multiple are set in one setAll call', () => {
    const requestJar = createCookieJar();
    const responseJar = createCookieJar();

    const cookies = {
      getAll() {
        return requestJar.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => requestJar.set(name, value));
        cookiesToSet.forEach(({ name, value, options }) =>
          responseJar.set(name, value, options)
        );
      },
    };

    const many = Array.from({ length: 8 }, (_, i) => ({
      name: `sb-chunk.${i}`,
      value: `v${i}`,
      options: { path: '/', maxAge: 100 + i } as CookieOptions,
    }));

    cookies.setAll(many);

    assert.equal(requestJar.getAll().length, 8);
    assert.equal(responseJar.getAll().length, 8);
    for (let i = 0; i < 8; i++) {
      const c = responseJar.snapshot().find((x) => x.name === `sb-chunk.${i}`);
      assert.ok(c);
      assert.equal(c!.value, `v${i}`);
      assert.equal(c!.options?.maxAge, 100 + i);
    }
  });
});
