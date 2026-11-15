import { db } from './db';
import { loadDemoData } from './seed';
import { exportBackupV2Json } from './backup/export';

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', [db.properties, db.clients, db.needs, db.followUps, db.activities], async () => {
    await Promise.all([
      db.properties.clear(),
      db.clients.clear(),
      db.needs.clear(),
      db.followUps.clear(),
      db.activities.clear(),
    ]);
  });
}

export async function resetToDemoData(): Promise<void> {
  await clearAllData();
  await loadDemoData();
}

/**
 * JSON backup of everything stored on this device (Backup v2).
 * Replaces the legacy v1 export used by the More page download button.
 * v1 files remain restorable via validateBackupInput.
 */
export async function exportAllData(): Promise<string> {
  return exportBackupV2Json();
}

/** @deprecated Prefer exportAllData / exportBackupV2Json. Kept for any external callers. */
export async function exportAllDataV1Legacy(): Promise<string> {
  const [properties, clients, needs, followUps, activities] = await Promise.all([
    db.properties.toArray(),
    db.clients.toArray(),
    db.needs.toArray(),
    db.followUps.toArray(),
    db.activities.toArray(),
  ]);
  return JSON.stringify(
    {
      app: 'rahyar',
      version: 1,
      exportedAt: new Date().toISOString(),
      properties,
      clients,
      needs,
      followUps,
      activities,
    },
    null,
    2,
  );
}
