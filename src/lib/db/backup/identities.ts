/**
 * Persistent deviceInstanceId and dataLineageId in db.meta.
 * deviceInstanceId is fixed per browser profile for the life of the DB.
 * dataLineageId changes when a full Replace restore imports a different lineage.
 *
 * Ensure operations are atomic on db.meta so concurrent tabs do not create
 * divergent identities.
 */

import { db } from '../db';
import {
  META_DATA_LINEAGE_ID,
  META_DEVICE_INSTANCE_ID,
} from './types';

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Ensure deviceInstanceId exists. Read+create run inside a single meta transaction
 * so concurrent callers share one identity.
 */
export async function ensureDeviceInstanceId(): Promise<string> {
  return db.transaction('rw', db.meta, async () => {
    const row = await db.meta.get(META_DEVICE_INSTANCE_ID);
    if (row && typeof row.value === 'string' && row.value.length > 0) {
      return row.value;
    }
    const id = randomId();
    await db.meta.put({ key: META_DEVICE_INSTANCE_ID, value: id });
    return id;
  });
}

/**
 * Ensure dataLineageId exists. Atomic on db.meta.
 */
export async function ensureDataLineageId(): Promise<string> {
  return db.transaction('rw', db.meta, async () => {
    const row = await db.meta.get(META_DATA_LINEAGE_ID);
    if (row && typeof row.value === 'string' && row.value.length > 0) {
      return row.value;
    }
    const id = randomId();
    await db.meta.put({ key: META_DATA_LINEAGE_ID, value: id });
    return id;
  });
}

export async function getDeviceInstanceId(): Promise<string | null> {
  const row = await db.meta.get(META_DEVICE_INSTANCE_ID);
  return row && typeof row.value === 'string' ? row.value : null;
}

export async function getDataLineageId(): Promise<string | null> {
  const row = await db.meta.get(META_DATA_LINEAGE_ID);
  return row && typeof row.value === 'string' ? row.value : null;
}

/**
 * Ensure both identities exist in one meta transaction (used before export).
 */
export async function ensureIdentities(): Promise<{
  deviceInstanceId: string;
  dataLineageId: string;
}> {
  return db.transaction('rw', db.meta, async () => {
    let deviceInstanceId: string;
    const deviceRow = await db.meta.get(META_DEVICE_INSTANCE_ID);
    if (deviceRow && typeof deviceRow.value === 'string' && deviceRow.value.length > 0) {
      deviceInstanceId = deviceRow.value;
    } else {
      deviceInstanceId = randomId();
      await db.meta.put({ key: META_DEVICE_INSTANCE_ID, value: deviceInstanceId });
    }

    let dataLineageId: string;
    const lineageRow = await db.meta.get(META_DATA_LINEAGE_ID);
    if (lineageRow && typeof lineageRow.value === 'string' && lineageRow.value.length > 0) {
      dataLineageId = lineageRow.value;
    } else {
      dataLineageId = randomId();
      await db.meta.put({ key: META_DATA_LINEAGE_ID, value: dataLineageId });
    }

    return { deviceInstanceId, dataLineageId };
  });
}
