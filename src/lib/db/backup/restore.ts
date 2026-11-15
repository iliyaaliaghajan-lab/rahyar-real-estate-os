/**
 * Atomic local Replace restore.
 *
 * Transaction includes all five business stores AND db.meta.
 * - Clear + replace the five business stores.
 * - Preserve destination deviceInstanceId (create inside tx if missing).
 * - Update only dataLineageId to the backup's lineage.
 * - Preserve all other meta keys.
 * Any failure rolls back the entire transaction — including a newly created device id.
 *
 * File selection / preview / validation never call this.
 * No restore-related writes run outside the main transaction.
 */

import { db } from '../db';
import {
  META_DATA_LINEAGE_ID,
  META_DEVICE_INSTANCE_ID,
  type BackupV2,
  type RestoreOptions,
} from './types';

export class RestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestoreError';
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Perform atomic Replace restore from a fully validated BackupV2.
 * Caller must have already validated and obtained explicit user confirmation.
 *
 * All identity reads/writes happen inside the same transaction as business data.
 */
export async function atomicReplaceRestore(
  backup: BackupV2,
  options: RestoreOptions = {},
): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.properties,
      db.clients,
      db.needs,
      db.followUps,
      db.activities,
      db.meta,
    ],
    async () => {
      // 1. Resolve destination deviceInstanceId INSIDE the transaction.
      // If missing, create it here so a later failure rolls it back too.
      const existingDevice = await db.meta.get(META_DEVICE_INSTANCE_ID);
      let destinationDeviceId: string;
      if (
        existingDevice &&
        typeof existingDevice.value === 'string' &&
        existingDevice.value.length > 0
      ) {
        destinationDeviceId = existingDevice.value;
      } else {
        destinationDeviceId = newId();
      }

      // 2. Clear all business data
      await Promise.all([
        db.properties.clear(),
        db.clients.clear(),
        db.needs.clear(),
        db.followUps.clear(),
        db.activities.clear(),
      ]);

      if (options.injectFailureAfterClear) {
        throw new RestoreError('injected failure after clear (test)');
      }

      // 3. Bulk insert business data
      if (backup.properties.length) await db.properties.bulkPut(backup.properties);
      if (backup.clients.length) await db.clients.bulkPut(backup.clients);
      if (backup.needs.length) await db.needs.bulkPut(backup.needs);
      if (backup.followUps.length) await db.followUps.bulkPut(backup.followUps);
      if (backup.activities.length) await db.activities.bulkPut(backup.activities);

      // 4. Identity metadata: preserve deviceInstanceId, update dataLineageId only.
      // Unrelated meta keys are never cleared.
      await db.meta.put({
        key: META_DEVICE_INSTANCE_ID,
        value: destinationDeviceId,
      });
      await db.meta.put({
        key: META_DATA_LINEAGE_ID,
        value: backup.dataLineageId,
      });

      if (options.injectFailureAfterMeta) {
        throw new RestoreError('injected failure after meta write (test)');
      }
    },
  );
}
