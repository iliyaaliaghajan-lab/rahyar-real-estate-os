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
 * This function revalidates and snapshots the payload before opening the
 * destructive transaction. The caller still owns explicit user confirmation.
 * No restore-related writes run outside the main transaction.
 */

import { db } from '../db';
import { validateBackupInput } from './validate';
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
  // Validate at the destructive boundary; callers cannot bypass checksum,
  // shape, enum, duplicate-ID, or foreign-key checks by calling this API directly.
  // Detach from caller-owned objects so the validated payload cannot be mutated
  // between checksum verification and the IndexedDB transaction.
  let candidate: unknown;
  try {
    candidate =
      typeof globalThis.structuredClone === 'function'
        ? globalThis.structuredClone(backup)
        : JSON.parse(JSON.stringify(backup));
  } catch {
    throw new RestoreError('Backup payload could not be copied safely');
  }

  const validation = await validateBackupInput(candidate);
  if (!validation.ok || validation.parsed?.kind !== 'v2' || !validation.normalized) {
    const details = validation.issues
      .slice(0, 3)
      .map((issue) => (issue.path ? issue.path + ': ' + issue.message : issue.message))
      .join('; ');
    throw new RestoreError('Backup validation failed: ' + (details || 'invalid Backup v2'));
  }
  const safeBackup = validation.normalized;

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
      if (safeBackup.properties.length) await db.properties.bulkPut(safeBackup.properties);
      if (safeBackup.clients.length) await db.clients.bulkPut(safeBackup.clients);
      if (safeBackup.needs.length) await db.needs.bulkPut(safeBackup.needs);
      if (safeBackup.followUps.length) await db.followUps.bulkPut(safeBackup.followUps);
      if (safeBackup.activities.length) await db.activities.bulkPut(safeBackup.activities);

      // 4. Identity metadata: preserve deviceInstanceId, update dataLineageId only.
      // Unrelated meta keys are never cleared.
      await db.meta.put({
        key: META_DEVICE_INSTANCE_ID,
        value: destinationDeviceId,
      });
      await db.meta.put({
        key: META_DATA_LINEAGE_ID,
        value: safeBackup.dataLineageId,
      });

      if (options.injectFailureAfterMeta) {
        throw new RestoreError('injected failure after meta write (test)');
      }
    },
  );
}
