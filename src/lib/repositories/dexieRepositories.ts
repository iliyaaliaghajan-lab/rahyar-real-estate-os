import type { Table } from 'dexie';
import { db } from '../db/db';
import { newId } from '../utils/ids';
import { matchesQuery } from '../utils/search';
import { PROPERTY_TYPE_LABELS, TRANSACTION_LABELS } from '../utils/labels';
import type { Activity, Client, ClientInput, FollowUp, FollowUpInput, Need, NeedInput, Property, PropertyInput } from '../../types';
import type {
  ActivityRepository, ClientRepository, FollowUpRepository, NeedRepository, PropertyRepository, Repositories,
} from './types';

type Stamped = { id: string; createdAt: number; updatedAt: number };

async function insert<T extends Stamped, I extends object>(table: Table<T, string>, input: I): Promise<T> {
  const now = Date.now();
  const row = { ...input, id: newId(), createdAt: now, updatedAt: now } as unknown as T;
  await table.add(row);
  return row;
}
async function patchRow<T extends Stamped, I extends object>(table: Table<T, string>, id: string, patch: Partial<I>): Promise<T> {
  const cur = await table.get(id);
  if (!cur) throw new Error('رکورد پیدا نشد');
  const next = { ...cur, ...patch, id: cur.id, createdAt: cur.createdAt, updatedAt: Date.now() } as T;
  await table.put(next);
  return next;
}

const activities: ActivityRepository = {
  async log(type, text) {
    const row: Activity = { id: newId(), type, text, createdAt: Date.now() };
    await db.activities.add(row);
  },
  recent: (limit) => db.activities.orderBy('createdAt').reverse().limit(limit).toArray(),
};

const properties: PropertyRepository = {
  list: async () => (await db.properties.toArray()).sort((a, b) => b.updatedAt - a.updatedAt),
  get: (id) => db.properties.get(id),
  async create(input: PropertyInput) {
    const row = await insert<Property, PropertyInput>(db.properties, input);
    await activities.log('property', `فایل جدید ثبت شد: ${row.title}`);
    return row;
  },
  async update(id, patch) {
    const row = await patchRow<Property, PropertyInput>(db.properties, id, patch);
    await activities.log('property', `فایل ویرایش شد: ${row.title}`);
    return row;
  },
  async remove(id) {
    await db.transaction('rw', db.properties, db.followUps, async () => {
      await db.properties.delete(id);
      await db.followUps.where('propertyId').equals(id).modify({ propertyId: null });
    });
  },
  async search(query) {
    const all = await properties.list();
    return all.filter((p) =>
      matchesQuery([p.title, p.location, p.neighborhood, p.description, p.contactName, p.contactPhone,
        TRANSACTION_LABELS[p.transactionType], PROPERTY_TYPE_LABELS[p.propertyType]], query));
  },
};

const clients: ClientRepository = {
  list: async () => (await db.clients.toArray()).sort((a, b) => b.updatedAt - a.updatedAt),
  get: (id) => db.clients.get(id),
  async create(input: ClientInput) {
    const row = await insert<Client, ClientInput>(db.clients, input);
    await activities.log('client', `مشتری جدید ثبت شد: ${row.name}`);
    return row;
  },
  update: (id, patch) => patchRow<Client, ClientInput>(db.clients, id, patch),
  async remove(id) {
    await db.transaction('rw', db.clients, db.needs, db.followUps, async () => {
      await db.needs.where('clientId').equals(id).delete();
      await db.followUps.where('clientId').equals(id).delete();
      await db.clients.delete(id);
    });
  },
  async search(query) {
    const all = await clients.list();
    return all.filter((c) => matchesQuery([c.name, c.phone, c.notes, ...c.tags], query));
  },
};

const needs: NeedRepository = {
  list: () => db.needs.toArray(),
  listByClient: async (clientId) => (await db.needs.where('clientId').equals(clientId).toArray()).sort((a, b) => a.createdAt - b.createdAt),
  get: (id) => db.needs.get(id),
  async create(input: NeedInput) {
    const row = await insert<Need, NeedInput>(db.needs, input);
    const c = await db.clients.get(row.clientId);
    await activities.log('need', `نیاز جدید ثبت شد${c ? ` برای ${c.name}` : ''}`);
    return row;
  },
  update: (id, patch) => patchRow<Need, NeedInput>(db.needs, id, patch),
  remove: (id) => db.needs.delete(id),
};

const followUps: FollowUpRepository = {
  list: async () => (await db.followUps.toArray()).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
  listByClient: async (clientId) => (await db.followUps.where('clientId').equals(clientId).toArray()).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
  get: (id) => db.followUps.get(id),
  async create(input: FollowUpInput) {
    const row = await insert<FollowUp, FollowUpInput>(db.followUps, input);
    await activities.log('followup', `پیگیری جدید: ${row.title}`);
    return row;
  },
  update: (id, patch) => patchRow<FollowUp, FollowUpInput>(db.followUps, id, patch),
  async setStatus(id, status) {
    const row = await patchRow<FollowUp, FollowUpInput>(db.followUps, id, { status });
    if (status === 'completed') await activities.log('followup', `پیگیری انجام شد: ${row.title}`);
    return row;
  },
  remove: (id) => db.followUps.delete(id),
};

export const dexieRepositories: Repositories = { properties, clients, needs, followUps, activities };
