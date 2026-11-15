/**
 * Dexie restore integration tests (scenarios A–D) covering all five business stores.
 *
 * Requires IndexedDB (browser) or fake-indexeddb in Node.
 * Without either: suite is skipped and must be reported as BLOCKED (not PASS).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const hasIndexedDB = typeof globalThis.indexedDB !== 'undefined';

describe('backup restore integration (Dexie)', { skip: !hasIndexedDB }, () => {
  let db: typeof import('../src/lib/db/db').db;
  let atomicReplaceRestore: typeof import('../src/lib/db/backup/restore').atomicReplaceRestore;
  let computeBackupChecksum: typeof import('../src/lib/db/backup/canonical').computeBackupChecksum;
  let META_DEVICE_INSTANCE_ID: typeof import('../src/lib/db/backup/types').META_DEVICE_INSTANCE_ID;
  let META_DATA_LINEAGE_ID: typeof import('../src/lib/db/backup/types').META_DATA_LINEAGE_ID;
  type BackupV2 = import('../src/lib/db/backup/types').BackupV2;

  const ts = 1_700_000_000_000;

  const oldProperty = {
    id: 'p-old',
    title: 'ملک قدیم',
    transactionType: 'sale' as const,
    propertyType: 'apartment' as const,
    area: 50,
    bedrooms: 1,
    location: 'تهران',
    neighborhood: 'ونک',
    price: 1_000_000_000,
    deposit: null,
    rent: null,
    floor: 1,
    totalFloors: 3,
    parking: true,
    elevator: false,
    storage: null,
    description: 'قدیم',
    contactName: 'الف',
    contactPhone: '0900',
    createdAt: ts,
    updatedAt: ts,
  };
  const newProperty = {
    ...oldProperty,
    id: 'p-new',
    title: 'ملک جدید',
    price: 2_000_000_000,
    description: 'جدید',
  };

  const oldClient = {
    id: 'c-old',
    name: 'مشتری قدیم',
    phone: '0900',
    notes: 'n-old',
    tags: ['t1'],
    createdAt: ts,
    updatedAt: ts,
  };
  const newClient = {
    id: 'c-new',
    name: 'مشتری جدید',
    phone: '0911',
    notes: 'n-new',
    tags: ['t2'],
    createdAt: ts + 1,
    updatedAt: ts + 1,
  };

  const oldNeed = {
    id: 'n-old',
    clientId: 'c-old',
    transactionType: 'rent' as const,
    propertyType: 'apartment' as const,
    minArea: 40,
    maxArea: 80,
    bedrooms: 1,
    location: 'تهران',
    maxPrice: null,
    maxDeposit: 100_000_000,
    maxRent: 5_000_000,
    notes: 'need-old',
    createdAt: ts,
    updatedAt: ts,
  };
  const newNeed = {
    ...oldNeed,
    id: 'n-new',
    clientId: 'c-new',
    notes: 'need-new',
    maxRent: 6_000_000,
  };

  const oldFollowUp = {
    id: 'f-old',
    title: 'پیگیری قدیم',
    clientId: 'c-old',
    propertyId: 'p-old',
    dueDate: '2026-01-15',
    status: 'pending' as const,
    notes: 'fu-old',
    createdAt: ts,
    updatedAt: ts,
  };
  const newFollowUp = {
    ...oldFollowUp,
    id: 'f-new',
    title: 'پیگیری جدید',
    clientId: 'c-new',
    propertyId: 'p-new',
    dueDate: '2026-02-20',
    status: 'completed' as const,
    notes: 'fu-new',
  };

  const oldActivity = {
    id: 'a-old',
    type: 'client' as const,
    text: 'activity-old',
    createdAt: ts,
  };
  const newActivity = {
    id: 'a-new',
    type: 'property' as const,
    text: 'activity-new',
    createdAt: ts + 2,
  };

  async function seedBaseline(): Promise<{ deviceId: string; lineageId: string }> {
    await db.transaction(
      'rw',
      [db.properties, db.clients, db.needs, db.followUps, db.activities, db.meta],
      async () => {
        await Promise.all([
          db.properties.clear(),
          db.clients.clear(),
          db.needs.clear(),
          db.followUps.clear(),
          db.activities.clear(),
        ]);
        await db.properties.put(oldProperty);
        await db.clients.put(oldClient);
        await db.needs.put(oldNeed);
        await db.followUps.put(oldFollowUp);
        await db.activities.put(oldActivity);
        await db.meta.put({ key: META_DEVICE_INSTANCE_ID, value: 'dest-device-fixed' });
        await db.meta.put({ key: META_DATA_LINEAGE_ID, value: 'old-lineage' });
        await db.meta.put({ key: 'unrelatedKey', value: 'keep-me' });
      },
    );
    return { deviceId: 'dest-device-fixed', lineageId: 'old-lineage' };
  }

  async function makeBackup(): Promise<BackupV2> {
    const base: Omit<BackupV2, 'checksum'> = {
      app: 'rahyar',
      formatVersion: 2,
      exportedAt: '2026-11-14T15:00:00.000Z',
      sourceDeviceInstanceId: 'source-device',
      dataLineageId: 'backup-lineage',
      counts: {
        properties: 1,
        clients: 1,
        needs: 1,
        followUps: 1,
        activities: 1,
      },
      properties: [newProperty],
      clients: [newClient],
      needs: [newNeed],
      followUps: [newFollowUp],
      activities: [newActivity],
    };
    const checksum = await computeBackupChecksum(base);
    return { ...base, checksum };
  }

  async function assertOldState() {
    assert.deepEqual(await db.properties.toArray(), [oldProperty]);
    assert.deepEqual(await db.clients.toArray(), [oldClient]);
    assert.deepEqual(await db.needs.toArray(), [oldNeed]);
    assert.deepEqual(await db.followUps.toArray(), [oldFollowUp]);
    assert.deepEqual(await db.activities.toArray(), [oldActivity]);
    assert.equal((await db.meta.get(META_DEVICE_INSTANCE_ID))?.value, 'dest-device-fixed');
    assert.equal((await db.meta.get(META_DATA_LINEAGE_ID))?.value, 'old-lineage');
    assert.equal((await db.meta.get('unrelatedKey'))?.value, 'keep-me');
  }

  async function assertNewState(deviceId: string) {
    assert.deepEqual(await db.properties.toArray(), [newProperty]);
    assert.deepEqual(await db.clients.toArray(), [newClient]);
    assert.deepEqual(await db.needs.toArray(), [newNeed]);
    assert.deepEqual(await db.followUps.toArray(), [newFollowUp]);
    assert.deepEqual(await db.activities.toArray(), [newActivity]);
    assert.equal((await db.meta.get(META_DEVICE_INSTANCE_ID))?.value, deviceId);
    assert.equal((await db.meta.get(META_DATA_LINEAGE_ID))?.value, 'backup-lineage');
    assert.equal((await db.meta.get('unrelatedKey'))?.value, 'keep-me');
  }

  before(async () => {
    ({ db } = await import('../src/lib/db/db'));
    ({ atomicReplaceRestore } = await import('../src/lib/db/backup/restore'));
    ({ computeBackupChecksum } = await import('../src/lib/db/backup/canonical'));
    ({ META_DEVICE_INSTANCE_ID, META_DATA_LINEAGE_ID } = await import(
      '../src/lib/db/backup/types'
    ));
  });

  after(async () => {
    try {
      await db.delete();
    } catch {
      /* ignore */
    }
  });

  it('A — successful restore replaces all five stores; preserves device + unrelated meta', async () => {
    const { deviceId } = await seedBaseline();
    const backup = await makeBackup();
    await atomicReplaceRestore(backup);
    await assertNewState(deviceId);
  });

  it('B — rollback after clear restores all five stores and meta exactly', async () => {
    await seedBaseline();
    const backup = await makeBackup();
    await assert.rejects(
      () => atomicReplaceRestore(backup, { injectFailureAfterClear: true }),
      /injected failure after clear/,
    );
    await assertOldState();
  });

  it('C — rollback after meta write restores all five stores and all meta', async () => {
    await seedBaseline();
    const backup = await makeBackup();
    await assert.rejects(
      () => atomicReplaceRestore(backup, { injectFailureAfterMeta: true }),
      /injected failure after meta/,
    );
    await assertOldState();
  });

  it('D — missing destination device id is rolled back when restore fails', async () => {
    await seedBaseline();
    await db.meta.delete(META_DEVICE_INSTANCE_ID);
    assert.equal(await db.meta.get(META_DEVICE_INSTANCE_ID), undefined);

    const backup = await makeBackup();
    await assert.rejects(
      () => atomicReplaceRestore(backup, { injectFailureAfterMeta: true }),
      /injected failure after meta/,
    );

    assert.equal(await db.meta.get(META_DEVICE_INSTANCE_ID), undefined);
    assert.equal((await db.meta.get(META_DATA_LINEAGE_ID))?.value, 'old-lineage');
    assert.deepEqual(await db.properties.toArray(), [oldProperty]);
    assert.deepEqual(await db.clients.toArray(), [oldClient]);
    assert.deepEqual(await db.needs.toArray(), [oldNeed]);
    assert.deepEqual(await db.followUps.toArray(), [oldFollowUp]);
    assert.deepEqual(await db.activities.toArray(), [oldActivity]);
  });
});

describe('backup restore integration environment', () => {
  it('reports IndexedDB availability (BLOCKED when missing)', () => {
    if (!hasIndexedDB) {
      console.log(
        'BLOCKED: no IndexedDB / fake-indexeddb; scenarios A–D not executed',
      );
    }
    assert.ok(true);
  });
});
