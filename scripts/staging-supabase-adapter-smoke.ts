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

function denialKind(error: { message?: string; code?: string; details?: string; hint?: string } | null): string {
  if (!error) return 'none';
  const msg = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase();
  const code = String(error.code || '');
  if (code === 'PGRST301' || msg.includes('jwt') || msg.includes('not authenticated')) return 'auth';
  if (
    code === '42501' ||
    msg.includes('permission denied') ||
    msg.includes('row-level security') ||
    msg.includes('violates row-level security')
  ) {
    return 'permission';
  }
  if (code === '23503' || msg.includes('foreign key')) return 'fk';
  return 'other';
}

function isAuthError(err: unknown): boolean {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: string }).name) : '';
  const msg = err instanceof Error ? err.message : String(err);
  return name === 'RepositoryAuthError' || /احراز هویت|عضویت فعال/.test(msg);
}

async function main() {
  const { url, anonKey, serviceKey } = loadConfig();
  const runId = randomBytes(4).toString('hex');
  const admin = adminClient(url, serviceKey);
  const cleanupFailures: string[] = [];
  const userIds: string[] = [];
  let orgAId: string | null = null;
  let orgBId: string | null = null;

  const emails = {
    ownerA: `adapter-owner-a-${runId}@example.invalid`,
    adminA: `adapter-admin-a-${runId}@example.invalid`,
    agentA: `adapter-agent-a-${runId}@example.invalid`,
    ownerB: `adapter-owner-b-${runId}@example.invalid`,
  };

  try {
    console.log(`Adapter Staging smoke run_id=${runId} pageSize=${SUPABASE_LIST_PAGE_SIZE}`);

    const idOwnerA = await createDisposable(admin, emails.ownerA, runId, 'ownerA');
    userIds.push(idOwnerA);
    const idAdminA = await createDisposable(admin, emails.adminA, runId, 'adminA');
    userIds.push(idAdminA);
    const idAgentA = await createDisposable(admin, emails.agentA, runId, 'agentA');
    userIds.push(idAgentA);
    const idOwnerB = await createDisposable(admin, emails.ownerB, runId, 'ownerB');
    userIds.push(idOwnerB);

    const clientOwnerA = await sessionFor(url, anonKey, admin, emails.ownerA, idOwnerA);
    const clientAdminA = await sessionFor(url, anonKey, admin, emails.adminA, idAdminA);
    const clientAgentA = await sessionFor(url, anonKey, admin, emails.agentA, idAgentA);
    const clientOwnerB = await sessionFor(url, anonKey, admin, emails.ownerB, idOwnerB);
    record('SETUP-SESSION', 'PASS', 'four disposable JWT sessions verified via getUser()');

    const createdA = await clientOwnerA.rpc('create_organization_with_owner', {
      p_name: `Adapter Smoke OrgA ${runId}`,
    });
    const rowA = Array.isArray(createdA.data) ? createdA.data[0] : createdA.data;
    if (createdA.error || !rowA?.organization_id) throw new Error('owner A organization create failed');
    orgAId = rowA.organization_id as string;

    const createdB = await clientOwnerB.rpc('create_organization_with_owner', {
      p_name: `Adapter Smoke OrgB ${runId}`,
    });
    const rowB = Array.isArray(createdB.data) ? createdB.data[0] : createdB.data;
    if (createdB.error || !rowB?.organization_id) throw new Error('owner B organization create failed');
    orgBId = rowB.organization_id as string;
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
        record(`MEMBERSHIP-${label}`, 'FAIL', `got role=${m?.role} org=${m?.organizationId?.slice(0, 8)}`);
      } else {
        record(`MEMBERSHIP-${label}`, 'PASS', `role=${m.role}`);
      }
    }

    const ownerRepos = reposFor(clientOwnerA);
    const adminRepos = reposFor(clientAdminA);
    const agentRepos = reposFor(clientAgentA);
    const ownerBRepos = reposFor(clientOwnerB);

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
    record('PROP-CREATE', prop.id && prop.price === 11_000_000_000 ? 'PASS' : 'FAIL', `id=${prop.id?.slice(0, 8)}`);

    const propGot = await ownerRepos.properties.get(prop.id);
    record('PROP-GET', propGot?.id === prop.id ? 'PASS' : 'FAIL', '');

    const propList = await ownerRepos.properties.list();
    record('PROP-LIST', propList.some((p) => p.id === prop.id) ? 'PASS' : 'FAIL', `n=${propList.length}`);

    const propSearch = await ownerRepos.properties.search('سعادت');
    record('PROP-SEARCH', propSearch.some((p) => p.id === prop.id) ? 'PASS' : 'FAIL', `n=${propSearch.length}`);

    const propUpdated = await ownerRepos.properties.update(prop.id, {
      title: `آپارتمان به‌روز ${runId}`,
      price: 12_000_000_000,
    });
    record(
      'PROP-UPDATE',
      propUpdated.title.includes('به‌روز') && propUpdated.price === 12_000_000_000 ? 'PASS' : 'FAIL',
      '',
    );

    const clientRow = await ownerRepos.clients.create({
      name: `مشتری ${runId}`,
      phone: '09121112233',
      notes: 'یادداشت',
      tags: ['خریدار', 'فوری'],
    });
    record('CLIENT-CREATE', clientRow.id ? 'PASS' : 'FAIL', '');

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

    const fu = await ownerRepos.followUps.create({
      clientId: clientRow.id,
      propertyId: prop.id,
      title: `پیگیری ${runId}`,
      dueDate: '2026-12-01',
      status: 'pending',
      notes: 'یادداشت پیگیری',
    });
    record('FU-CREATE', fu.id && fu.dueDate === '2026-12-01' ? 'PASS' : 'FAIL', `due=${fu.dueDate}`);

    const needsByClient = await ownerRepos.needs.listByClient(clientRow.id);
    record('NEED-LIST-BY-CLIENT', needsByClient.some((n) => n.id === need.id) ? 'PASS' : 'FAIL', '');

    const fuByClient = await ownerRepos.followUps.listByClient(clientRow.id);
    record('FU-LIST-BY-CLIENT', fuByClient.some((f) => f.id === fu.id) ? 'PASS' : 'FAIL', '');

    const fuStatus = await ownerRepos.followUps.setStatus(fu.id, 'completed');
    record('FU-SET-STATUS', fuStatus.status === 'completed' ? 'PASS' : 'FAIL', '');

    await ownerRepos.activities.log('client', `رویداد آزمایشی ${runId}`);
    const recent = await ownerRepos.activities.recent(10);
    record('ACTIVITY-RECENT', recent.some((a) => a.text.includes(runId)) ? 'PASS' : 'FAIL', `n=${recent.length}`);

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
    const agentPropUp = await agentRepos.properties.update(agentProp.id, { description: 'ویرایش agent' });
    record('AGENT-PROP-UPDATE', agentPropUp.description === 'ویرایش agent' ? 'PASS' : 'FAIL', '');

    async function expectDeleteDenied(
      label: string,
      remover: Repositories,
      table: 'properties' | 'clients' | 'needs' | 'followUps',
      id: string,
      reader: Repositories,
    ) {
      let threw = false;
      let kind = 'none';
      try {
        if (table === 'properties') await remover.properties.remove(id);
        else if (table === 'clients') await remover.clients.remove(id);
        else if (table === 'needs') await remover.needs.remove(id);
        else await remover.followUps.remove(id);
      } catch (e) {
        threw = true;
        kind = denialKind(e as { message?: string; code?: string });
        if (isAuthError(e)) kind = 'auth';
      }
      let stillThere = false;
      try {
        if (table === 'properties') stillThere = !!(await reader.properties.get(id));
        else if (table === 'clients') stillThere = !!(await reader.clients.get(id));
        else if (table === 'needs') stillThere = !!(await reader.needs.get(id));
        else stillThere = !!(await reader.followUps.get(id));
      } catch {
        stillThere = false;
      }
      const ok = stillThere && kind !== 'auth' && kind !== 'fk';
      record(label, ok ? 'PASS' : 'FAIL', `threw=${threw} kind=${kind} stillThere=${stillThere}`);
    }

    await expectDeleteDenied('AGENT-DENY-OWN-PROP', agentRepos, 'properties', agentProp.id, ownerRepos);
    await expectDeleteDenied('AGENT-DENY-OWNER-PROP', agentRepos, 'properties', prop.id, ownerRepos);
    await expectDeleteDenied('AGENT-DENY-OWNER-NEED', agentRepos, 'needs', need.id, ownerRepos);
    await expectDeleteDenied('AGENT-DENY-OWNER-FU', agentRepos, 'followUps', fu.id, ownerRepos);
    await expectDeleteDenied('AGENT-DENY-OWNER-CLIENT', agentRepos, 'clients', clientRow.id, ownerRepos);

    try {
      await adminRepos.properties.remove(agentProp.id);
      const gone = await ownerRepos.properties.get(agentProp.id);
      record('ADMIN-DELETE-PROP', !gone ? 'PASS' : 'FAIL', '');
    } catch (e) {
      record('ADMIN-DELETE-PROP', 'FAIL', denialKind(e as { code?: string; message?: string }));
    }

    const orgBClient = await ownerBRepos.clients.create({
      name: `OrgB Client ${runId}`,
      phone: '09120001111',
      notes: '',
      tags: [],
    });
    await expectDeleteDenied('ADMIN-DENY-ORGB-CLIENT', adminRepos, 'clients', orgBClient.id, ownerBRepos);
    const stillB = await ownerBRepos.clients.get(orgBClient.id);
    record('OWNERB-SEES-AFTER-ADMIN-DENY', stillB?.id === orgBClient.id ? 'PASS' : 'FAIL', '');

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
      record('OWNER-CLIENT-CASCADE', 'FAIL', String((e as Error).message || e));
    }

    try {
      await ownerRepos.properties.remove(prop.id);
      record('OWNER-PROP-DELETE', !(await ownerRepos.properties.get(prop.id)) ? 'PASS' : 'FAIL', '');
    } catch (e) {
      record('OWNER-PROP-DELETE', 'FAIL', String((e as Error).message || e));
    }

    record('PAGE-SIZE-CONST', SUPABASE_LIST_PAGE_SIZE === 500 ? 'PASS' : 'FAIL', String(SUPABASE_LIST_PAGE_SIZE));
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
      if (ins.error || !ins.data) throw new Error(`page seed insert failed at ${i}`);
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

    const revoked = await admin
      .from('organization_members')
      .update({ status: 'removed' })
      .eq('organization_id', orgAId)
      .eq('user_id', idAgentA)
      .select('id, status');
    if (revoked.error) throw new Error('agent membership revoke failed');
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
    try {
      if (orgAId) {
        await admin.from('follow_ups').delete().eq('organization_id', orgAId);
        await admin.from('needs').delete().eq('organization_id', orgAId);
        await admin.from('properties').delete().eq('organization_id', orgAId);
        await admin.from('clients').delete().eq('organization_id', orgAId);
        await admin.from('activities').delete().eq('organization_id', orgAId);
      }
      if (orgBId) {
        await admin.from('follow_ups').delete().eq('organization_id', orgBId);
        await admin.from('needs').delete().eq('organization_id', orgBId);
        await admin.from('properties').delete().eq('organization_id', orgBId);
        await admin.from('clients').delete().eq('organization_id', orgBId);
        await admin.from('activities').delete().eq('organization_id', orgBId);
      }
    } catch {
      cleanupFailures.push('business-rows');
    }
    try {
      if (orgAId) {
        await admin.from('organization_members').delete().eq('organization_id', orgAId);
        await admin.from('organizations').delete().eq('id', orgAId);
      }
      if (orgBId) {
        await admin.from('organization_members').delete().eq('organization_id', orgBId);
        await admin.from('organizations').delete().eq('id', orgBId);
      }
    } catch {
      cleanupFailures.push('orgs');
    }
    for (const uid of userIds) {
      try {
        const del = await admin.auth.admin.deleteUser(uid);
        if (del.error) cleanupFailures.push(`user:${uid.slice(0, 8)}`);
      } catch {
        cleanupFailures.push(`user-ex:${uid.slice(0, 8)}`);
      }
    }
    if (orgAId) {
      const chk = await admin.from('organizations').select('id').eq('id', orgAId).maybeSingle();
      if (chk.data?.id) cleanupFailures.push('orgA-still-present');
    }
    if (orgBId) {
      const chk = await admin.from('organizations').select('id').eq('id', orgBId).maybeSingle();
      if (chk.data?.id) cleanupFailures.push('orgB-still-present');
    }

    if (cleanupFailures.length === 0) {
      record('CLEANUP', 'PASS', 'orgs and disposable users removed');
    } else {
      record('CLEANUP', 'FAIL', cleanupFailures.join(','));
    }
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  console.log(`\nSUMMARY passed=${passed} failed=${failed} skipped=${skipped} run_id=${runId}`);
  if (failed > 0 || cleanupFailures.length > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('FATAL', e instanceof Error ? e.message : e);
  process.exit(1);
});
