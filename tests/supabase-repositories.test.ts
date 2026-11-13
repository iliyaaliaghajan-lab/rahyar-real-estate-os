/**
 * Unit tests for Supabase repository mappers and adapter behavior.
 * Uses deterministic mocks — no live Supabase / Staging access.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  activityFromRow,
  activityInsertRow,
  clientFromRow,
  clientInsertRow,
  clientUpdateRow,
  dueDateFromPg,
  dueDateToPg,
  followUpFromRow,
  followUpInsertRow,
  followUpUpdateRow,
  isUuid,
  isoToMs,
  moneyOrNull,
  msToIso,
  needFromRow,
  needInsertRow,
  needUpdateRow,
  nowIso,
  propertyFromRow,
  propertyInsertRow,
  propertyUpdateRow,
} from '../src/lib/repositories/supabaseMappers';
import { createSupabaseRepositories } from '../src/lib/repositories/supabaseRepositories';
import { repositories } from '../src/lib/repositories/index';
import { dexieRepositories } from '../src/lib/repositories/dexieRepositories';
import type { PropertyInput, ClientInput, NeedInput, FollowUpInput } from '../src/types';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PROP_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = '22222222-2222-4222-8222-222222222222';
const NEED_ID = '33333333-3333-4333-8333-333333333333';
const FU_ID = '44444444-4444-4444-8444-444444444444';
const ACT_ID = '55555555-5555-4555-8555-555555555555';

describe('supabaseMappers — UUID validation', () => {
  it('accepts standard UUIDs', () => {
    assert.equal(isUuid(PROP_ID), true);
    assert.equal(isUuid(ORG), true);
  });

  it('rejects legacy non-UUID ids from newId fallback', () => {
    assert.equal(isUuid('id-m1abc-xyz123'), false);
    assert.equal(isUuid('not-a-uuid'), false);
    assert.equal(isUuid(''), false);
    assert.equal(isUuid(null), false);
  });
});

describe('supabaseMappers — timestamps and dates', () => {
  it('round-trips milliseconds through ISO', () => {
    const ms = 1_704_067_200_000;
    const iso = msToIso(ms);
    assert.match(iso, /T/);
    assert.equal(isoToMs(iso), ms);
  });

  it('isoToMs returns 0 for empty', () => {
    assert.equal(isoToMs(''), 0);
    assert.equal(isoToMs(null), 0);
  });

  it('dueDate keeps YYYY-MM-DD and strips timestamp suffix', () => {
    assert.equal(dueDateToPg('2026-11-13'), '2026-11-13');
    assert.equal(dueDateFromPg('2026-11-13'), '2026-11-13');
    assert.equal(dueDateFromPg('2026-11-13T00:00:00'), '2026-11-13');
  });
});

describe('supabaseMappers — property', () => {
  const input: PropertyInput = {
    title: 'آپارتمان نیاوران',
    transactionType: 'sale',
    propertyType: 'apartment',
    area: 120,
    bedrooms: 3,
    location: 'تهران',
    neighborhood: 'نیاوران',
    price: 25_000_000_000,
    deposit: null,
    rent: null,
    floor: 4,
    totalFloors: 6,
    parking: true,
    elevator: true,
    storage: false,
    description: 'نورگیر',
    contactName: 'علی',
    contactPhone: '09120000000',
  };

  it('maps insert row with org and audit, without client-supplied id', () => {
    const row = propertyInsertRow(input, ORG, USER);
    assert.equal(row.organization_id, ORG);
    assert.equal(row.created_by, USER);
    assert.equal(row.updated_by, USER);
    assert.equal(row.transaction_type, 'sale');
    assert.equal(row.property_type, 'apartment');
    assert.equal(row.contact_name, 'علی');
    assert.equal(row.total_floors, 6);
    assert.equal(row.price, 25_000_000_000);
    assert.equal('id' in row, false);
  });

  it('maps row back to domain model with camelCase and ms timestamps', () => {
    const iso = '2026-01-15T10:00:00.000Z';
    const model = propertyFromRow({
      id: PROP_ID,
      organization_id: ORG,
      title: input.title,
      transaction_type: 'sale',
      property_type: 'apartment',
      area: '120.5',
      bedrooms: 3,
      location: input.location,
      neighborhood: input.neighborhood,
      price: '25000000000',
      deposit: null,
      rent: null,
      floor: 4,
      total_floors: 6,
      parking: true,
      elevator: true,
      storage: false,
      description: input.description,
      contact_name: input.contactName,
      contact_phone: input.contactPhone,
      created_by: USER,
      updated_by: USER,
      created_at: iso,
      updated_at: iso,
    });
    assert.equal(model.id, PROP_ID);
    assert.equal(model.transactionType, 'sale');
    assert.equal(model.propertyType, 'apartment');
    assert.equal(model.area, 120.5);
    assert.equal(model.price, 25_000_000_000);
    assert.equal(model.contactName, 'علی');
    assert.equal(model.totalFloors, 6);
    assert.equal(model.createdAt, isoToMs(iso));
  });

  it('update row sets updated_by, updated_at, and omits immutable fields', () => {
    const fixed = '2026-11-13T12:00:00.000Z';
    const row = propertyUpdateRow({ title: 'x', price: 1 }, USER_B, fixed);
    assert.equal(row.updated_by, USER_B);
    assert.equal(row.updated_at, fixed);
    assert.equal(row.title, 'x');
    assert.equal('id' in row, false);
    assert.equal('organization_id' in row, false);
    assert.equal('created_by' in row, false);
    assert.equal('created_at' in row, false);
  });
});

describe('supabaseMappers — client / need / followUp / activity', () => {
  it('client tags and snake_case fields', () => {
    const input: ClientInput = { name: 'سارا', phone: '0912', notes: '', tags: ['vip'] };
    const insert = clientInsertRow(input, ORG, USER);
    assert.deepEqual(insert.tags, ['vip']);
    const model = clientFromRow({
      id: CLIENT_ID,
      organization_id: ORG,
      name: 'سارا',
      phone: '0912',
      notes: '',
      tags: ['vip'],
      created_by: USER,
      updated_by: USER,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    assert.deepEqual(model.tags, ['vip']);
    const fixed = '2026-11-13T12:00:00.000Z';
    const upd = clientUpdateRow({ notes: 'n' }, USER, fixed);
    assert.equal(upd.notes, 'n');
    assert.equal(upd.updated_by, USER);
    assert.equal(upd.updated_at, fixed);
  });

  it('need client_id and area/price mapping', () => {
    const input: NeedInput = {
      clientId: CLIENT_ID,
      transactionType: 'rent',
      propertyType: null,
      minArea: 50,
      maxArea: 90,
      bedrooms: 2,
      location: 'مرکز',
      maxPrice: null,
      maxDeposit: 100,
      maxRent: 20,
      notes: '',
    };
    const insert = needInsertRow(input, ORG, USER);
    assert.equal(insert.client_id, CLIENT_ID);
    assert.equal(insert.max_deposit, 100);
    const model = needFromRow({
      id: NEED_ID,
      organization_id: ORG,
      client_id: CLIENT_ID,
      transaction_type: 'rent',
      property_type: null,
      min_area: 50,
      max_area: 90,
      bedrooms: 2,
      location: 'مرکز',
      max_price: null,
      max_deposit: 100,
      max_rent: 20,
      notes: '',
      created_by: USER,
      updated_by: USER,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(model.clientId, CLIENT_ID);
    assert.equal(model.maxDeposit, 100);
    const fixed = '2026-11-13T12:00:00.000Z';
    const upd = needUpdateRow({ maxRent: 25 }, USER, fixed);
    assert.equal(upd.max_rent, 25);
    assert.equal(upd.updated_at, fixed);
  });

  it('follow_up property_id null and due_date', () => {
    const input: FollowUpInput = {
      title: 'تماس',
      clientId: CLIENT_ID,
      propertyId: null,
      dueDate: '2026-12-01',
      status: 'pending',
      notes: '',
    };
    const insert = followUpInsertRow(input, ORG, USER);
    assert.equal(insert.property_id, null);
    assert.equal(insert.due_date, '2026-12-01');
    const model = followUpFromRow({
      id: FU_ID,
      organization_id: ORG,
      title: 'تماس',
      client_id: CLIENT_ID,
      property_id: null,
      due_date: '2026-12-01',
      status: 'pending',
      notes: '',
      created_by: USER,
      updated_by: USER,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(model.propertyId, null);
    assert.equal(model.dueDate, '2026-12-01');
    const fixed = '2026-11-13T12:00:00.000Z';
    const upd = followUpUpdateRow({ status: 'completed' }, USER, fixed);
    assert.equal(upd.status, 'completed');
    assert.equal(upd.updated_at, fixed);
  });

  it('activity insert has no updated_by', () => {
    const insert = activityInsertRow('client', 'hello', ORG, USER);
    assert.equal(insert.created_by, USER);
    assert.equal(insert.organization_id, ORG);
    assert.equal('updated_by' in insert, false);
    const model = activityFromRow({
      id: ACT_ID,
      organization_id: ORG,
      type: 'client',
      text: 'hello',
      created_by: USER,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(model.type, 'client');
    assert.equal(model.text, 'hello');
  });
});

// --- Mock Supabase chain ---

type TableName = 'properties' | 'clients' | 'needs' | 'follow_ups' | 'activities';

function makeMockClient(handlers: {
  onInsert?: (table: TableName, payload: unknown) => { data: unknown; error: null | { message: string } };
  onSelect?: (table: TableName, filters: Record<string, string>) => { data: unknown; error: null | { message: string } };
  onUpdate?: (table: TableName, payload: unknown, filters: Record<string, string>) => { data: unknown; error: null | { message: string } };
  onDelete?: (table: TableName, filters: Record<string, string>) => { data: unknown; error: null | { message: string } };
}) {
  const filters: Record<string, string> = {};
  let table: TableName = 'properties';
  let mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
  let payload: unknown;

  const builder: Record<string, unknown> = {};
  const self = () => builder;

  builder.from = (t: TableName) => {
    table = t;
    Object.keys(filters).forEach((k) => delete filters[k]);
    mode = 'select';
    payload = undefined;
    return builder;
  };
  builder.select = () => self();
  builder.insert = (p: unknown) => {
    mode = 'insert';
    payload = p;
    return builder;
  };
  builder.update = (p: unknown) => {
    mode = 'update';
    payload = p;
    return builder;
  };
  builder.delete = () => {
    mode = 'delete';
    return builder;
  };
  builder.eq = (col: string, val: string) => {
    filters[col] = val;
    return builder;
  };
  builder.order = () => self();
  builder.limit = () => self();
  builder.maybeSingle = async () => {
    if (mode === 'select') return handlers.onSelect?.(table, { ...filters }) ?? { data: null, error: null };
    if (mode === 'update') return handlers.onUpdate?.(table, payload, { ...filters }) ?? { data: null, error: null };
    return { data: null, error: null };
  };
  builder.single = async () => {
    if (mode === 'insert') return handlers.onInsert?.(table, payload) ?? { data: null, error: { message: 'no handler' } };
    return { data: null, error: { message: 'no single' } };
  };
  builder.then = undefined;
  const run = async () => {
    if (mode === 'select') return handlers.onSelect?.(table, { ...filters }) ?? { data: [], error: null };
    if (mode === 'insert') return handlers.onInsert?.(table, payload) ?? { data: null, error: { message: 'no handler' } };
    if (mode === 'update') return handlers.onUpdate?.(table, payload, { ...filters }) ?? { data: null, error: null };
    if (mode === 'delete') return handlers.onDelete?.(table, { ...filters }) ?? { data: [], error: null };
    return { data: null, error: null };
  };
  (builder as { then?: unknown }).then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(run()).then(resolve, reject);

  return builder as unknown as import('@supabase/supabase-js').SupabaseClient;
}

describe('createSupabaseRepositories — auth fail-closed', () => {
  it('throws when membership is null', async () => {
    const repos = createSupabaseRepositories({
      supabase: makeMockClient({}),
      getMembership: async () => null,
    });
    await assert.rejects(() => repos.properties.list(), /احراز هویت|عضویت/);
  });

  it('get returns undefined for legacy non-UUID id without querying', async () => {
    let called = false;
    const repos = createSupabaseRepositories({
      supabase: makeMockClient({
        onSelect: () => {
          called = true;
          return { data: null, error: null };
        },
      }),
      getMembership: async () => ({
        organizationId: ORG,
        organizationName: 'A',
        role: 'owner',
        userId: USER,
      }),
    });
    const got = await repos.properties.get('id-legacy-not-uuid');
    assert.equal(got, undefined);
    assert.equal(called, false);
  });
});

describe('createSupabaseRepositories — CRUD with mocks', () => {
  const membership = {
    organizationId: ORG,
    organizationName: 'Org A',
    role: 'owner' as const,
    userId: USER,
  };

  it('creates property with org scope and returns mapped row', async () => {
    const iso = '2026-03-01T12:00:00.000Z';
    const insertedTables: string[] = [];
    const repos = createSupabaseRepositories({
      getMembership: async () => membership,
      supabase: makeMockClient({
        onInsert: (table, payload) => {
          insertedTables.push(table);
          const p = payload as Record<string, unknown>;
          assert.equal(p.organization_id, ORG);
          assert.equal(p.created_by, USER);
          if (table === 'properties') {
            assert.equal(p.title, 'P1');
            return {
              data: {
                id: PROP_ID,
                organization_id: ORG,
                title: 'P1',
                transaction_type: 'sale',
                property_type: 'apartment',
                area: 80,
                bedrooms: 2,
                location: 'L',
                neighborhood: 'N',
                price: 1,
                deposit: null,
                rent: null,
                floor: null,
                total_floors: null,
                parking: null,
                elevator: null,
                storage: null,
                description: '',
                contact_name: '',
                contact_phone: '',
                created_by: USER,
                updated_by: USER,
                created_at: iso,
                updated_at: iso,
              },
              error: null,
            };
          }
          assert.equal(table, 'activities');
          return { data: null, error: null };
        },
      }),
    });

    const row = await repos.properties.create({
      title: 'P1',
      transactionType: 'sale',
      propertyType: 'apartment',
      area: 80,
      bedrooms: 2,
      location: 'L',
      neighborhood: 'N',
      price: 1,
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
    assert.equal(row.id, PROP_ID);
    assert.equal(row.title, 'P1');
    assert.equal(row.transactionType, 'sale');
    assert.deepEqual(insertedTables, ['properties', 'activities']);
  });

  it('lists clients ordered via select and maps tags', async () => {
    const iso = '2026-03-01T12:00:00.000Z';
    const repos = createSupabaseRepositories({
      getMembership: async () => membership,
      supabase: makeMockClient({
        onSelect: (table, filters) => {
          assert.equal(table, 'clients');
          assert.equal(filters.organization_id, ORG);
          return {
            data: [
              {
                id: CLIENT_ID,
                organization_id: ORG,
                name: 'C1',
                phone: '09',
                notes: '',
                tags: ['a'],
                created_by: USER,
                updated_by: USER,
                created_at: iso,
                updated_at: iso,
              },
            ],
            error: null,
          };
        },
      }),
    });
    const list = await repos.clients.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'C1');
    assert.deepEqual(list[0].tags, ['a']);
  });

  it('deletes property with org filter (FK clears follow-up property_id in DB)', async () => {
    const repos = createSupabaseRepositories({
      getMembership: async () => membership,
      supabase: makeMockClient({
        onDelete: (table, filters) => {
          assert.equal(table, 'properties');
          assert.equal(filters.organization_id, ORG);
          assert.equal(filters.id, PROP_ID);
          return { data: [{ id: PROP_ID }], error: null };
        },
      }),
    });
    await repos.properties.remove(PROP_ID);
  });

  it('deletes client with org filter (cascade handled by DB)', async () => {
    const repos = createSupabaseRepositories({
      getMembership: async () => membership,
      supabase: makeMockClient({
        onDelete: (table, filters) => {
          assert.equal(table, 'clients');
          assert.equal(filters.id, CLIENT_ID);
          return { data: [{ id: CLIENT_ID }], error: null };
        },
      }),
    });
    await repos.clients.remove(CLIENT_ID);
  });

  it('activities recent is org-scoped; no update API on interface', async () => {
    const iso = '2026-03-01T12:00:00.000Z';
    const repos = createSupabaseRepositories({
      getMembership: async () => membership,
      supabase: makeMockClient({
        onSelect: (table, filters) => {
          assert.equal(table, 'activities');
          assert.equal(filters.organization_id, ORG);
          return {
            data: [
              {
                id: ACT_ID,
                organization_id: ORG,
                type: 'property',
                text: 't',
                created_by: USER,
                created_at: iso,
              },
            ],
            error: null,
          };
        },
      }),
    });
    const recent = await repos.activities.recent(5);
    assert.equal(recent.length, 1);
    assert.equal(recent[0].text, 't');
    assert.equal('update' in repos.activities, false);
    assert.equal('remove' in repos.activities, false);
  });

  it('search properties uses same label-aware filtering as Dexie path', async () => {
    const iso = '2026-03-01T12:00:00.000Z';
    const repos = createSupabaseRepositories({
      getMembership: async () => membership,
      supabase: makeMockClient({
        onSelect: () => ({
          data: [
            {
              id: PROP_ID,
              organization_id: ORG,
              title: 'واحد تجاری',
              transaction_type: 'sale',
              property_type: 'shop',
              area: null,
              bedrooms: null,
              location: 'بازار',
              neighborhood: '',
              price: null,
              deposit: null,
              rent: null,
              floor: null,
              total_floors: null,
              parking: null,
              elevator: null,
              storage: null,
              description: '',
              contact_name: '',
              contact_phone: '',
              created_by: USER,
              updated_by: USER,
              created_at: iso,
              updated_at: iso,
            },
          ],
          error: null,
        }),
      }),
    });
    const hits = await repos.properties.search('مغازه');
    assert.equal(hits.length, 1);
    const miss = await repos.properties.search('ویلای-ناموجود');
    assert.equal(miss.length, 0);
  });
});

describe('supabaseMappers — updated_at on all update mappers', () => {
  it('every update mapper includes the injected updated_at exactly', () => {
    const fixed = '2026-05-01T08:30:00.000Z';
    assert.equal(propertyUpdateRow({}, USER, fixed).updated_at, fixed);
    assert.equal(clientUpdateRow({}, USER, fixed).updated_at, fixed);
    assert.equal(needUpdateRow({}, USER, fixed).updated_at, fixed);
    assert.equal(followUpUpdateRow({}, USER, fixed).updated_at, fixed);
  });

  it('nowIso round-trips through msToIso', () => {
    const ms = 1_720_000_000_000;
    assert.equal(nowIso(ms), msToIso(ms));
  });
});

describe('supabaseMappers — BIGINT safe integer money', () => {
  it('accepts MAX_SAFE_INTEGER and null', () => {
    assert.equal(moneyOrNull(Number.MAX_SAFE_INTEGER, 'price'), Number.MAX_SAFE_INTEGER);
    assert.equal(moneyOrNull(null, 'price'), null);
    assert.equal(moneyOrNull(0, 'price'), 0);
  });

  it('rejects values beyond MAX_SAFE_INTEGER', () => {
    assert.throws(() => moneyOrNull(Number.MAX_SAFE_INTEGER + 1, 'price'), /خارج از محدوده/);
    assert.throws(() => moneyOrNull(String(Number.MAX_SAFE_INTEGER) + '0', 'price'), /خارج از محدوده/);
    assert.throws(() => moneyOrNull(1.5, 'price'), /خارج از محدوده/);
  });

  it('property insert/fromRow use moneyOrNull for price fields', () => {
    const input: PropertyInput = {
      title: 't',
      transactionType: 'sale',
      propertyType: 'other',
      area: 12.5,
      bedrooms: null,
      location: '',
      neighborhood: '',
      price: Number.MAX_SAFE_INTEGER,
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
    };
    const insert = propertyInsertRow(input, ORG, USER);
    assert.equal(insert.price, Number.MAX_SAFE_INTEGER);
    assert.equal(insert.area, 12.5);
    assert.throws(
      () => propertyInsertRow({ ...input, price: Number.MAX_SAFE_INTEGER + 1 }, ORG, USER),
      /خارج از محدوده/,
    );
  });
});

describe('createSupabaseRepositories — best-effort activity', () => {
  const membership = {
    organizationId: ORG,
    organizationName: 'Org A',
    role: 'owner' as const,
    userId: USER,
  };

  it('returns committed property when activity insert fails', async () => {
    const iso = '2026-03-01T12:00:00.000Z';
    const repos = createSupabaseRepositories({
      getMembership: async () => membership,
      supabase: makeMockClient({
        onInsert: (table, payload) => {
          if (table === 'properties') {
            return {
              data: {
                id: PROP_ID,
                organization_id: ORG,
                title: 'P1',
                transaction_type: 'sale',
                property_type: 'apartment',
                area: 80,
                bedrooms: 2,
                location: 'L',
                neighborhood: 'N',
                price: 1,
                deposit: null,
                rent: null,
                floor: null,
                total_floors: null,
                parking: null,
                elevator: null,
                storage: null,
                description: '',
                contact_name: '',
                contact_phone: '',
                created_by: USER,
                updated_by: USER,
                created_at: iso,
                updated_at: iso,
              },
              error: null,
            };
          }
          assert.equal(table, 'activities');
          return { data: null, error: { message: 'activity denied' } };
        },
      }),
    });
    const row = await repos.properties.create({
      title: 'P1',
      transactionType: 'sale',
      propertyType: 'apartment',
      area: 80,
      bedrooms: 2,
      location: 'L',
      neighborhood: 'N',
      price: 1,
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
    assert.equal(row.id, PROP_ID);
    assert.equal(row.title, 'P1');
  });
});

describe('default repositories export remains Dexie', () => {
  it('index repositories is the Dexie implementation', () => {
    assert.equal(repositories, dexieRepositories);
  });
});
