import Dexie, { type Table } from 'dexie';
import type { Activity, Client, FollowUp, Need, Property } from '../../types';

export interface MetaRow { key: string; value: unknown }

/** IndexedDB schema. Only the repositories (and maintenance/seed) may import this. */
export class RahyarDB extends Dexie {
  properties!: Table<Property, string>;
  clients!: Table<Client, string>;
  needs!: Table<Need, string>;
  followUps!: Table<FollowUp, string>;
  activities!: Table<Activity, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('rahyar');
    this.version(1).stores({
      properties: 'id, transactionType, propertyType, updatedAt',
      clients: 'id, name, updatedAt',
      needs: 'id, clientId, updatedAt',
      followUps: 'id, clientId, propertyId, dueDate, status',
      activities: 'id, createdAt',
      meta: 'key',
    });
  }
}

export const db = new RahyarDB();
