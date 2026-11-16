import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBackupChecksum,
  stableStringify,
  verifyBackupChecksum,
} from '../src/lib/db/backup/canonical';
import type { BackupV2 } from '../src/lib/db/backup/types';

async function minimalBackup(overrides: Partial<BackupV2> = {}): Promise<BackupV2> {
  const base: Omit<BackupV2, 'checksum'> = {
    app: 'rahyar',
    formatVersion: 2,
    exportedAt: '2026-11-14T12:00:00.000Z',
    sourceDeviceInstanceId: 'dev-aaa',
    dataLineageId: 'lin-bbb',
    counts: { properties: 0, clients: 0, needs: 0, followUps: 0, activities: 0 },
    properties: [],
    clients: [],
    needs: [],
    followUps: [],
    activities: [],
  };
  const withOverrides = { ...base, ...overrides };
  const { checksum: _c, ...rest } = withOverrides as BackupV2;
  const checksum = await computeBackupChecksum(rest);
  return { ...rest, checksum };
}

describe('backup canonical + checksum', () => {
  it('stableStringify sorts object keys', () => {
    const a = stableStringify({ b: 1, a: 2 });
    const b = stableStringify({ a: 2, b: 1 });
    assert.equal(a, b);
    assert.equal(a, '{"a":2,"b":1}');
  });

  it('checksum is stable for same payload', async () => {
    const b1 = await minimalBackup();
    const b2 = await minimalBackup();
    assert.equal(b1.checksum, b2.checksum);
    assert.equal(b1.checksum.length, 64);
  });

  it('changing any covered field invalidates checksum', async () => {
    const good = await minimalBackup();
    assert.equal(await verifyBackupChecksum(good), true);

    const badLineage = { ...good, dataLineageId: 'changed' };
    assert.equal(await verifyBackupChecksum(badLineage), false);

    const badCount = {
      ...good,
      counts: { ...good.counts, properties: 1 },
    };
    assert.equal(await verifyBackupChecksum(badCount), false);

    const badExported = { ...good, exportedAt: '2099-01-01T00:00:00.000Z' };
    assert.equal(await verifyBackupChecksum(badExported), false);
  });

  it('checksum excludes only the checksum field itself', async () => {
    const good = await minimalBackup();
    const differentChecksumField = { ...good, checksum: '0'.repeat(64) };
    assert.equal(await verifyBackupChecksum(differentChecksumField), false);
  });

  it('__proto__ key at root is preserved and affects checksum', async () => {
    const payloadA: Record<string, unknown> = Object.create(null);
    Object.assign(payloadA, {
      app: 'rahyar',
      formatVersion: 2,
      exportedAt: '2026-11-14T12:00:00.000Z',
      sourceDeviceInstanceId: 'dev-aaa',
      dataLineageId: 'lin-bbb',
      counts: { properties: 0, clients: 0, needs: 0, followUps: 0, activities: 0 },
      properties: [],
      clients: [],
      needs: [],
      followUps: [],
      activities: [],
    });
    const payloadB: Record<string, unknown> = Object.create(null);
    Object.assign(payloadB, payloadA);
    Object.defineProperty(payloadB, '__proto__', {
      value: 'attacker-value',
      enumerable: true,
      configurable: true,
      writable: true,
    });

    const sA = stableStringify(payloadA);
    const sB = stableStringify(payloadB);
    assert.notEqual(sA, sB);
    assert.ok(sB.includes('"__proto__"'), 'canonical JSON must include __proto__ key');

    const sumA = await computeBackupChecksum(payloadA as unknown as BackupV2);
    const sumB = await computeBackupChecksum(payloadB as unknown as BackupV2);
    assert.notEqual(sumA, sumB);
  });

  it('__proto__ key inside a record affects checksum', async () => {
    const clientA = {
      id: 'c1',
      name: 'x',
      phone: '',
      notes: '',
      tags: [] as string[],
      createdAt: 1,
      updatedAt: 1,
    };
    const clientB: Record<string, unknown> = Object.create(null);
    Object.assign(clientB, clientA);
    Object.defineProperty(clientB, '__proto__', {
      value: 'evil',
      enumerable: true,
      configurable: true,
      writable: true,
    });

    const a = await minimalBackup({
      clients: [clientA],
      counts: { properties: 0, clients: 1, needs: 0, followUps: 0, activities: 0 },
    });
    const payload: Record<string, unknown> = {
      app: 'rahyar',
      formatVersion: 2,
      exportedAt: a.exportedAt,
      sourceDeviceInstanceId: a.sourceDeviceInstanceId,
      dataLineageId: a.dataLineageId,
      counts: { properties: 0, clients: 1, needs: 0, followUps: 0, activities: 0 },
      properties: [],
      clients: [clientB],
      needs: [],
      followUps: [],
      activities: [],
    };
    const sumB = await computeBackupChecksum(payload as unknown as BackupV2);
    assert.notEqual(a.checksum, sumB);
  });
});
