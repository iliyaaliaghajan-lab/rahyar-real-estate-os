/**
 * Staging adapter smoke helpers: config, clients, strict delete denial classification.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getCurrentMembership } from '../src/lib/auth/organization';
import { createSupabaseRepositories } from '../src/lib/repositories/supabaseRepositories';
import type { Repositories } from '../src/lib/repositories/types';

export const STAGING_ORIGIN = 'https://dezonafotwyvvghbccko.supabase.co';
export const STAGING_CONFIRM = 'dezonafotwyvvghbccko';
export const PRODUCTION_REF = 'gguvmewknanhzukugvpj';

export type Status = 'PASS' | 'FAIL' | 'SKIP';
export const results: Array<{ name: string; status: Status; detail: string }> = [];

export function record(name: string, status: Status, detail: string) {
  results.push({ name, status, detail });
  const mark = status === 'PASS' ? '\u2713' : status === 'FAIL' ? '\u2717' : '\u25cb';
  console.log(`${mark} ${status} ${name}${detail ? ` \u2014 ${detail}` : ''}`);
}

export function refusal(message: string): never {
  console.error(`REFUSAL: ${message}`);
  process.exit(2);
}

export function loadConfig() {
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

export function anonClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function adminClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function createDisposable(
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

export async function sessionFor(
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

export function reposFor(client: SupabaseClient): Repositories {
  return createSupabaseRepositories({
    supabase: client,
    getMembership: () => getCurrentMembership(client),
  });
}

export type TableKey = 'properties' | 'clients' | 'needs' | 'followUps';

export function denialKind(error: {
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

export function isAuthError(err: unknown): boolean {
  const name =
    err && typeof err === 'object' && 'name' in err ? String((err as { name: string }).name) : '';
  const msg = err instanceof Error ? err.message : String(err);
  return name === 'RepositoryAuthError' || /\u0627\u062d\u0631\u0627\u0632 \u0647\u0648\u06cc\u062a|\u0639\u0636\u0648\u06cc\u062a \u0641\u0639\u0627\u0644/.test(msg);
}

/** Only permission RLS denials and RepositoryNotFoundError (0-row RLS delete) count as valid. */
export function classifyDeleteDenial(err: unknown): {
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

export async function adapterRemove(repos: Repositories, table: TableKey, id: string): Promise<void> {
  if (table === 'properties') await repos.properties.remove(id);
  else if (table === 'clients') await repos.clients.remove(id);
  else if (table === 'needs') await repos.needs.remove(id);
  else await repos.followUps.remove(id);
}

export async function adapterGet(
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

export async function expectDeleteDenied(
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

export async function expectDeleteAllowed(
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

export async function checkedDelete(
  admin: SupabaseClient,
  table: string,
  filterCol: string,
  filterVal: string,
  cleanupFailures: string[],
  label: string,
): Promise<void> {
  const res = await admin.from(table).delete().eq(filterCol, filterVal).select('id');
  if (res.error) {
    cleanupFailures.push(`${label}:${res.error.code || 'error'}`);
  }
}
