/**
 * Supabase Data API implementation of storage-agnostic Repository interfaces.
 *
 * Adapter-only: does not change the default Dexie export in index.ts.
 * Uses the browser anon client + authenticated membership; RLS remains authoritative.
 *
 * Activity timeline writes are best-effort after a successful business write.
 * A failed activity insert does not fail the primary operation (may leave a gap
 * until a future outbox/sync phase). Role-specific CRUD authorization remains a
 * separate security review item; this adapter relies on RLS + membership gates.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentMembership, type CurrentMembership } from '../auth/organization';
import { createClient } from '../supabase/client';
import { matchesQuery } from '../utils/search';
import { PROPERTY_TYPE_LABELS, TRANSACTION_LABELS } from '../utils/labels';
import type {
  Activity,
  Client,
  ClientInput,
  FollowUp,
  FollowUpInput,
  Need,
  NeedInput,
  Property,
  PropertyInput,
} from '../../types';
import type {
  ActivityRepository,
  ClientRepository,
  FollowUpRepository,
  NeedRepository,
  PropertyRepository,
  Repositories,
} from './types';
import {
  activityFromRow,
  activityInsertRow,
  clientFromRow,
  clientInsertRow,
  clientUpdateRow,
  followUpFromRow,
  followUpInsertRow,
  followUpUpdateRow,
  isUuid,
  needFromRow,
  needInsertRow,
  needUpdateRow,
  propertyFromRow,
  propertyInsertRow,
  propertyUpdateRow,
  type ActivityRow,
  type ClientRow,
  type FollowUpRow,
  type NeedRow,
  type PropertyRow,
} from './supabaseMappers';

export type MembershipResolver = () => Promise<CurrentMembership | null>;

export interface SupabaseRepositoryDeps {
  /** Injected client (tests). Default: browser anon client. */
  supabase?: SupabaseClient;
  /** Injected membership resolver (tests). Default: getCurrentMembership. */
  getMembership?: MembershipResolver;
}

class RepositoryAuthError extends Error {
  constructor(message = 'احراز هویت یا عضویت فعال یافت نشد') {
    super(message);
    this.name = 'RepositoryAuthError';
  }
}

class RepositoryNotFoundError extends Error {
  constructor(message = 'رکورد پیدا نشد') {
    super(message);
    this.name = 'RepositoryNotFoundError';
  }
}

class RepositoryIdError extends Error {
  constructor(message = 'شناسه نامعتبر است') {
    super(message);
    this.name = 'RepositoryIdError';
  }
}

function requireUuid(id: string, label = 'id'): string {
  if (!isUuid(id)) {
    throw new RepositoryIdError(`شناسه نامعتبر (${label}): انتظار UUID`);
  }
  return id;
}

async function requireMembership(
  getMembership: MembershipResolver,
): Promise<CurrentMembership> {
  const m = await getMembership();
  if (!m?.organizationId || !m?.userId) {
    throw new RepositoryAuthError();
  }
  if (!isUuid(m.organizationId) || !isUuid(m.userId)) {
    throw new RepositoryAuthError('شناسه سازمان یا کاربر نامعتبر است');
  }
  return m;
}

function throwIfError(error: { message?: string } | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message || 'unknown error'}`);
  }
}

/**
 * Page size for multi-request list/search fetches.
 * Must not assume a page shorter than this is the final page — Max Rows may be lower.
 * Prefer exact count from the first request; advance offset by rows actually received.
 *
 * Multi-page reads are not a single transactional snapshot; concurrent writes may
 * change membership of later pages relative to the initial count.
 */
export const SUPABASE_LIST_PAGE_SIZE = 500;

type OrderBy = { column: string; ascending: boolean };

/**
 * Fetch all organization-scoped rows across pages using range() + exact count.
 * Fails closed on page errors, missing count, stalled offset, or early empty pages.
 */
async function fetchAllPages<TRow>(
  sb: SupabaseClient,
  table: string,
  organizationId: string,
  orders: OrderBy[],
  extraEq: Array<[string, string]> = [],
): Promise<TRow[]> {
  const results: TRow[] = [];
  let offset = 0;
  let total: number | null = null;
  let requestExactCount = true;

  while (true) {
    // requestExactCount is a plain boolean flag (not derived from total) so the
    // select options and the awaited count field do not form a TS control-flow cycle.
    const selectOpts = requestExactCount
      ? ({ count: 'exact' } as const)
      : ({} as const);

    let builder = sb
      .from(table)
      .select('*', selectOpts)
      .eq('organization_id', organizationId);

    for (const [col, val] of extraEq) {
      builder = builder.eq(col, val);
    }
    for (const o of orders) {
      builder = builder.order(o.column, { ascending: o.ascending });
    }
    // Deterministic secondary key when primary order is not id alone
    if (!orders.some((o) => o.column === 'id')) {
      builder = builder.order('id', { ascending: true });
    }

    const to = offset + SUPABASE_LIST_PAGE_SIZE - 1;
    const page = builder.range(offset, to);

    const { data, error, count } = await page;
    throwIfError(error, `${table} list page at offset ${offset}`);

    if (requestExactCount) {
      if (typeof count !== 'number' || count < 0) {
        throw new Error(`${table} list: exact total count unavailable`);
      }
      total = count;
      requestExactCount = false;
    }
    // After the first successful page, total is always a non-negative number.
    if (total === null) {
      throw new Error(`${table} list: total count was not established`);
    }

    const rows = (data ?? []) as TRow[];
    results.push(...rows);

    if (results.length >= total) {
      break;
    }
    if (rows.length === 0) {
      throw new Error(
        `${table} list: empty page before total (have ${results.length} of ${total})`,
      );
    }

    const prevOffset = offset;
    offset += rows.length;
    if (offset <= prevOffset) {
      throw new Error(`${table} list: pagination offset stalled at ${offset}`);
    }
  }

  return results;
}

/**
 * Best-effort timeline write after a committed business operation.
 * Never throws; does not include private customer data in warnings.
 */
async function bestEffortActivity(
  log: ActivityRepository['log'],
  type: Activity['type'],
  text: string,
): Promise<void> {
  try {
    await log(type, text);
  } catch {
    console.warn('[supabaseRepositories] activity write failed; timeline event may be missing');
  }
}

export function createSupabaseRepositories(deps: SupabaseRepositoryDeps = {}): Repositories {
  const getSupabase = () => deps.supabase ?? createClient();
  const getMembership = deps.getMembership ?? getCurrentMembership;

  const activities: ActivityRepository = {
    async log(type, text) {
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      const { error } = await sb.from('activities').insert(
        activityInsertRow(type, text, m.organizationId, m.userId),
      );
      throwIfError(error, 'activity insert');
    },
    async recent(limit) {
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      const { data, error } = await sb
        .from('activities')
        .select('*')
        .eq('organization_id', m.organizationId)
        .order('created_at', { ascending: false })
        .limit(limit);
      throwIfError(error, 'activity recent');
      return ((data ?? []) as ActivityRow[]).map(activityFromRow);
    },
  };

  const properties: PropertyRepository = {
    async list() {
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      const rows = await fetchAllPages<PropertyRow>(sb, 'properties', m.organizationId, [
        { column: 'updated_at', ascending: false },
      ]);
      return rows.map(propertyFromRow);
    },
    async get(id) {
      if (!isUuid(id)) return undefined;
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      const { data, error } = await sb
        .from('properties')
        .select('*')
        .eq('organization_id', m.organizationId)
        .eq('id', id)
        .maybeSingle();
      throwIfError(error, 'properties get');
      return data ? propertyFromRow(data as PropertyRow) : undefined;
    },
    async create(input: PropertyInput) {
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      const { data, error } = await sb
        .from('properties')
        .insert(propertyInsertRow(input, m.organizationId, m.userId))
        .select('*')
        .single();
      throwIfError(error, 'properties create');
      const row = propertyFromRow(data as PropertyRow);
      await bestEffortActivity(activities.log, 'property', 'فایل جدید ثبت شد');
      return row;
    },
    async update(id, patch) {
      requireUuid(id);
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      const { data, error } = await sb
        .from('properties')
        .update(propertyUpdateRow(patch, m.userId))
        .eq('organization_id', m.organizationId)
        .eq('id', id)
        .select('*')
        .maybeSingle();
      throwIfError(error, 'properties update');
      if (!data) throw new RepositoryNotFoundError();
      const row = propertyFromRow(data as PropertyRow);
      await bestEffortActivity(activities.log, 'property', 'فایل ویرایش شد');
      return row;
    },
    async remove(id) {
      requireUuid(id);
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      // Migration 009: follow_ups.property_id ON DELETE SET NULL
      const { data, error } = await sb
        .from('properties')
        .delete()
        .eq('organization_id', m.organizationId)
        .eq('id', id)
        .select('id');
      throwIfError(error, 'properties remove');
      if (!data || data.length === 0) throw new RepositoryNotFoundError();
    },
    async search(query) {
      const all = await properties.list();
      return all.filter((p) =>
        matchesQuery(
          [
            p.title,
            p.location,
            p.neighborhood,
            p.description,
            p.contactName,
            p.contactPhone,
            TRANSACTION_LABELS[p.transactionType],
            PROPERTY_TYPE_LABELS[p.propertyType],
          ],
          query,
        ),
      );
    },
  };

  const clients: ClientRepository = {
    async list() {
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      const rows = await fetchAllPages<ClientRow>(sb, 'clients', m.organizationId, [
        { column: 'updated_at', ascending: false },
      ]);
      return rows.map(clientFromRow);
    },
    async get(id) {
      if (!isUuid(id)) return undefined;
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      const { data, error } = await sb
        .from('clients')
        .select('*')
        .eq('organization_id', m.organizationId)
        .eq('id', id)
        .maybeSingle();
      throwIfError(error, 'clients get');
      return data ? clientFromRow(data as ClientRow) : undefined;
    },
    async create(input: ClientInput) {
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      const { data, error } = await sb
        .from('clients')
        .insert(clientInsertRow(input, m.organizationId, m.userId))
        .select('*')
        .single();
      throwIfError(error, 'clients create');
      const row = clientFromRow(data as ClientRow);
      await bestEffortActivity(activities.log, 'client', 'مشتری جدید ثبت شد');
      return row;
    },
    async update(id, patch) {
      requireUuid(id);
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      const { data, error } = await sb
        .from('clients')
        .update(clientUpdateRow(patch, m.userId))
        .eq('organization_id', m.organizationId)
        .eq('id', id)
        .select('*')
        .maybeSingle();
      throwIfError(error, 'clients update');
      if (!data) throw new RepositoryNotFoundError();
      return clientFromRow(data as ClientRow);
    },
    async remove(id) {
      requireUuid(id);
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      // Migration 009: needs/follow_ups client FK ON DELETE CASCADE
      const { data, error } = await sb
        .from('clients')
        .delete()
        .eq('organization_id', m.organizationId)
        .eq('id', id)
        .select('id');
      throwIfError(error, 'clients remove');
      if (!data || data.length === 0) throw new RepositoryNotFoundError();
    },
    async search(query) {
      const all = await clients.list();
      return all.filter((c) => matchesQuery([c.name, c.phone, c.notes, ...c.tags], query));
    },
  };

  const needs: NeedRepository = {
    // Deterministic order: created_at ASC, id ASC (documented for pagination stability)
    async list() {
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      const rows = await fetchAllPages<NeedRow>(sb, 'needs', m.organizationId, [
        { column: 'created_at', ascending: true },
      ]);
      return rows.map(needFromRow);
    },
    async listByClient(clientId) {
      requireUuid(clientId, 'clientId');
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      const rows = await fetchAllPages<NeedRow>(
        sb,
        'needs',
        m.organizationId,
        [{ column: 'created_at', ascending: true }],
        [['client_id', clientId]],
      );
      return rows.map(needFromRow);
    },
    async get(id) {
      if (!isUuid(id)) return undefined;
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      const { data, error } = await sb
        .from('needs')
        .select('*')
        .eq('organization_id', m.organizationId)
        .eq('id', id)
        .maybeSingle();
      throwIfError(error, 'needs get');
      return data ? needFromRow(data as NeedRow) : undefined;
    },
    async create(input: NeedInput) {
      requireUuid(input.clientId, 'clientId');
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      const { data, error } = await sb
        .from('needs')
        .insert(needInsertRow(input, m.organizationId, m.userId))
        .select('*')
        .single();
      throwIfError(error, 'needs create');
      const row = needFromRow(data as NeedRow);
      // No post-commit client lookup; activity is best-effort and non-sensitive.
      await bestEffortActivity(activities.log, 'need', 'نیاز جدید ثبت شد');
      return row;
    },
    async update(id, patch) {
      requireUuid(id);
      if (patch.clientId !== undefined) requireUuid(patch.clientId, 'clientId');
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      const { data, error } = await sb
        .from('needs')
        .update(needUpdateRow(patch, m.userId))
        .eq('organization_id', m.organizationId)
        .eq('id', id)
        .select('*')
        .maybeSingle();
      throwIfError(error, 'needs update');
      if (!data) throw new RepositoryNotFoundError();
      return needFromRow(data as NeedRow);
    },
    async remove(id) {
      requireUuid(id);
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      const { data, error } = await sb
        .from('needs')
        .delete()
        .eq('organization_id', m.organizationId)
        .eq('id', id)
        .select('id');
      throwIfError(error, 'needs remove');
      if (!data || data.length === 0) throw new RepositoryNotFoundError();
    },
  };

  const followUps: FollowUpRepository = {
    async list() {
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      const rows = await fetchAllPages<FollowUpRow>(sb, 'follow_ups', m.organizationId, [
        { column: 'due_date', ascending: true },
      ]);
      return rows.map(followUpFromRow);
    },
    async listByClient(clientId) {
      requireUuid(clientId, 'clientId');
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      const rows = await fetchAllPages<FollowUpRow>(
        sb,
        'follow_ups',
        m.organizationId,
        [{ column: 'due_date', ascending: true }],
        [['client_id', clientId]],
      );
      return rows.map(followUpFromRow);
    },
    async get(id) {
      if (!isUuid(id)) return undefined;
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      const { data, error } = await sb
        .from('follow_ups')
        .select('*')
        .eq('organization_id', m.organizationId)
        .eq('id', id)
        .maybeSingle();
      throwIfError(error, 'follow_ups get');
      return data ? followUpFromRow(data as FollowUpRow) : undefined;
    },
    async create(input: FollowUpInput) {
      requireUuid(input.clientId, 'clientId');
      if (input.propertyId) requireUuid(input.propertyId, 'propertyId');
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      const { data, error } = await sb
        .from('follow_ups')
        .insert(followUpInsertRow(input, m.organizationId, m.userId))
        .select('*')
        .single();
      throwIfError(error, 'follow_ups create');
      const row = followUpFromRow(data as FollowUpRow);
      await bestEffortActivity(activities.log, 'followup', 'پیگیری جدید ثبت شد');
      return row;
    },
    async update(id, patch) {
      requireUuid(id);
      if (patch.clientId !== undefined) requireUuid(patch.clientId, 'clientId');
      if (patch.propertyId) requireUuid(patch.propertyId, 'propertyId');
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      const { data, error } = await sb
        .from('follow_ups')
        .update(followUpUpdateRow(patch, m.userId))
        .eq('organization_id', m.organizationId)
        .eq('id', id)
        .select('*')
        .maybeSingle();
      throwIfError(error, 'follow_ups update');
      if (!data) throw new RepositoryNotFoundError();
      return followUpFromRow(data as FollowUpRow);
    },
    async setStatus(id, status) {
      const row = await followUps.update(id, { status });
      if (status === 'completed') {
        await bestEffortActivity(activities.log, 'followup', 'پیگیری انجام شد');
      }
      return row;
    },
    async remove(id) {
      requireUuid(id);
      const m = await requireMembership(getMembership);
      const sb = getSupabase();
      const { data, error } = await sb
        .from('follow_ups')
        .delete()
        .eq('organization_id', m.organizationId)
        .eq('id', id)
        .select('id');
      throwIfError(error, 'follow_ups remove');
      if (!data || data.length === 0) throw new RepositoryNotFoundError();
    },
  };

  return { properties, clients, needs, followUps, activities };
}

/** Default singleton for explicit import (tests / future activation). Not wired into index.ts. */
export const supabaseRepositories: Repositories = createSupabaseRepositories();
