import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateBackupInput } from '../src/lib/db/backup/validate';
import { computeBackupChecksum } from '../src/lib/db/backup/canonical';
import type { BackupV2 } from '../src/lib/db/backup/types';

const sampleClient = {
  id: 'c1',
  name: 'علی',
  phone: '0912',
  notes: '',
  tags: [] as string[],
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const sampleProperty = {
  id: 'p1',
  title: 'آپارتمان',
  transactionType: 'sale' as const,
  propertyType: 'apartment' as const,
  area: 80,
  bedrooms: 2,
  location: 'تهران',
  neighborhood: '',
  price: 10_000_000_000,
  deposit: null,
  rent: null,
  floor: 3,
  totalFloors: 5,
  parking: true,
  elevator: true,
  storage: null,
  description: '',
  contactName: '',
  contactPhone: '',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

async function makeV2(partial: Partial<Omit<BackupV2, 'checksum'>> = {}): Promise<BackupV2> {
  const base: Omit<BackupV2, 'checksum'> = {
    app: 'rahyar',
    formatVersion: 2,
    exportedAt: '2026-11-14T12:00:00.000Z',
    sourceDeviceInstanceId: 'dev-1',
    dataLineageId: 'lin-1',
    counts: {
      properties: 1,
      clients: 1,
      needs: 0,
      followUps: 0,
      activities: 0,
    },
    properties: [sampleProperty],
    clients: [sampleClient],
    needs: [],
    followUps: [],
    activities: [],
    ...partial,
  };
  base.counts = {
    properties: base.properties.length,
    clients: base.clients.length,
    needs: base.needs.length,
    followUps: base.followUps.length,
    activities: base.activities.length,
  };
  const checksum = await computeBackupChecksum(base);
  return { ...base, checksum };
}

describe('backup validate', () => {
  it('accepts a valid v2 backup', async () => {
    const b = await makeV2();
    const r = await validateBackupInput(JSON.stringify(b));
    assert.equal(r.ok, true);
    assert.equal(r.issues.length, 0);
    assert.ok(r.normalized);
    assert.equal(r.normalized!.checksum, b.checksum);
    assert.equal(r.checksumValid, true);
  });

  it('rejects tampered checksum and reports checksumValid false', async () => {
    const b = await makeV2();
    b.checksum = 'a'.repeat(64);
    const r = await validateBackupInput(b);
    assert.equal(r.ok, false);
    assert.equal(r.checksumValid, false);
    assert.ok(r.issues.some((i) => i.code === 'checksum'));
  });

  it('rejects unsafe money', async () => {
    const badProp = { ...sampleProperty, price: 1.5 };
    const b = await makeV2({ properties: [badProp] });
    const r = await validateBackupInput(b);
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.code === 'money'));
  });

  it('rejects duplicate ids', async () => {
    const b = await makeV2({
      clients: [sampleClient, { ...sampleClient }],
    });
    const r = await validateBackupInput(b);
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.code === 'duplicate_id'));
  });

  it('rejects broken foreign key', async () => {
    const need = {
      id: 'n1',
      clientId: 'missing-client',
      transactionType: 'rent' as const,
      propertyType: null,
      minArea: null,
      maxArea: null,
      bedrooms: null,
      location: '',
      maxPrice: null,
      maxDeposit: null,
      maxRent: null,
      notes: '',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    };
    const b = await makeV2({ needs: [need] });
    const r = await validateBackupInput(b);
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.code === 'fk'));
  });

  it('rejects invalid calendar date', async () => {
    const fu = {
      id: 'f1',
      title: 'تماس',
      clientId: 'c1',
      propertyId: null,
      dueDate: '2026-02-30',
      status: 'pending' as const,
      notes: '',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    };
    const b = await makeV2({ followUps: [fu] });
    const r = await validateBackupInput(b);
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.code === 'date'));
  });

  it('accepts and upgrades valid v1 legacy with checksumValid null', async () => {
    const v1 = {
      app: 'rahyar',
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      properties: [sampleProperty],
      clients: [sampleClient],
      needs: [],
      followUps: [],
      activities: [],
    };
    const r = await validateBackupInput(JSON.stringify(v1));
    assert.equal(r.ok, true);
    assert.equal(r.parsed?.kind, 'v1');
    assert.ok(r.normalized);
    assert.equal(r.normalized!.formatVersion, 2);
    assert.equal(r.normalized!.properties.length, 1);
    assert.equal(r.checksumValid, null);
  });

  it('rejects unknown format', async () => {
    const r = await validateBackupInput({ app: 'rahyar', version: 99 });
    assert.equal(r.ok, false);
    assert.equal(r.checksumValid, null);
  });

  it('v2 accepts valid ISO UTC exportedAt', async () => {
    const b = await makeV2({ exportedAt: '2026-11-14T12:00:00.000Z' });
    const r = await validateBackupInput(b);
    assert.equal(r.ok, true);
  });

  it('v2 rejects empty exportedAt', async () => {
    const b = await makeV2({ exportedAt: '' });
    const r = await validateBackupInput(b);
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.path === 'exportedAt'));
  });

  it('v2 rejects impossible calendar day in exportedAt', async () => {
    const b = await makeV2({ exportedAt: '2026-02-30T12:00:00.000Z' });
    const r = await validateBackupInput(b);
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.path === 'exportedAt'));
  });

  it('v2 rejects exportedAt without timezone Z', async () => {
    const b = await makeV2({ exportedAt: '2026-11-14T12:00:00.000' });
    const r = await validateBackupInput(b);
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.path === 'exportedAt'));
  });

  it('v2 rejects invalid month in exportedAt', async () => {
    const b = await makeV2({ exportedAt: '2026-13-01T12:00:00.000Z' });
    const r = await validateBackupInput(b);
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.path === 'exportedAt'));
  });

  it('v2 rejects invalid hour in exportedAt', async () => {
    const b = await makeV2({ exportedAt: '2026-11-14T25:00:00.000Z' });
    const r = await validateBackupInput(b);
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.path === 'exportedAt'));
  });

  it('v2 rejects non-string exportedAt', async () => {
    const b = await makeV2();
    const raw = { ...b, exportedAt: 12345 };
    const r = await validateBackupInput(raw);
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.path === 'exportedAt'));
  });

  it('v1 accepts valid ISO UTC exportedAt', async () => {
    const v1 = {
      app: 'rahyar',
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      properties: [sampleProperty],
      clients: [sampleClient],
      needs: [],
      followUps: [],
      activities: [],
    };
    const r = await validateBackupInput(JSON.stringify(v1));
    assert.equal(r.ok, true);
    assert.equal(r.parsed?.kind, 'v1');
  });

  it('v1 rejects impossible date in exportedAt', async () => {
    const v1 = {
      app: 'rahyar',
      version: 1,
      exportedAt: '2026-02-30T12:00:00.000Z',
      properties: [sampleProperty],
      clients: [sampleClient],
      needs: [],
      followUps: [],
      activities: [],
    };
    const r = await validateBackupInput(JSON.stringify(v1));
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.path === 'exportedAt'));
  });
});
