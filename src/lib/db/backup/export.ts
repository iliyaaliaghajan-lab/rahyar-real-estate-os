/**
 * Consistent Dexie snapshot → Backup v2 with canonical checksum.
 *
 * Identities are ensured first, then business stores AND meta are read in one
 * readonly transaction so data + lineage reflect a single consistent state.
 */

import { db } from '../db';
import { computeBackupChecksum } from './canonical';
import { ensureIdentities } from './identities';
import {
  BACKUP_APP,
  BACKUP_FORMAT_VERSION,
  META_DATA_LINEAGE_ID,
  META_DEVICE_INSTANCE_ID,
  type BackupCounts,
  type BackupV2,
} from './types';

/**
 * Ensure identities exist, then snapshot five business stores + meta identities
 * in a single readonly transaction.
 */
export async function createBackupV2(): Promise<BackupV2> {
  // Create missing identities if needed (write). Snapshot is separate and readonly.
  await ensureIdentities();

  const snapshot = await db.transaction(
    'r',
    [db.properties, db.clients, db.needs, db.followUps, db.activities, db.meta],
    async () => {
      const [properties, clients, needs, followUps, activities, deviceRow, lineageRow] =
        await Promise.all([
          db.properties.toArray(),
          db.clients.toArray(),
          db.needs.toArray(),
          db.followUps.toArray(),
          db.activities.toArray(),
          db.meta.get(META_DEVICE_INSTANCE_ID),
          db.meta.get(META_DATA_LINEAGE_ID),
        ]);

      const deviceInstanceId =
        deviceRow && typeof deviceRow.value === 'string' ? deviceRow.value : '';
      const dataLineageId =
        lineageRow && typeof lineageRow.value === 'string' ? lineageRow.value : '';

      return {
        properties,
        clients,
        needs,
        followUps,
        activities,
        deviceInstanceId,
        dataLineageId,
      };
    },
  );

  if (!snapshot.deviceInstanceId || !snapshot.dataLineageId) {
    throw new Error(
      'Backup snapshot missing deviceInstanceId or dataLineageId after ensureIdentities',
    );
  }

  const counts: BackupCounts = {
    properties: snapshot.properties.length,
    clients: snapshot.clients.length,
    needs: snapshot.needs.length,
    followUps: snapshot.followUps.length,
    activities: snapshot.activities.length,
  };

  const withoutChecksum: Omit<BackupV2, 'checksum'> = {
    app: BACKUP_APP,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    sourceDeviceInstanceId: snapshot.deviceInstanceId,
    dataLineageId: snapshot.dataLineageId,
    counts,
    properties: snapshot.properties,
    clients: snapshot.clients,
    needs: snapshot.needs,
    followUps: snapshot.followUps,
    activities: snapshot.activities,
  };

  const checksum = await computeBackupChecksum(withoutChecksum);
  return { ...withoutChecksum, checksum };
}

/** Pretty-printed JSON suitable for download. */
export async function exportBackupV2Json(): Promise<string> {
  const backup = await createBackupV2();
  return JSON.stringify(backup, null, 2);
}

/** Current business-store counts (for preview). */
export async function getCurrentCounts(): Promise<BackupCounts> {
  const [properties, clients, needs, followUps, activities] = await Promise.all([
    db.properties.count(),
    db.clients.count(),
    db.needs.count(),
    db.followUps.count(),
    db.activities.count(),
  ]);
  return { properties, clients, needs, followUps, activities };
}
