/**
 * Public API for Backup v2 + Local Restore (Phase 1).
 * No Supabase / cloud imports.
 */

export {
  BACKUP_APP,
  BACKUP_FORMAT_VERSION,
  BUSINESS_STORES,
  META_DATA_LINEAGE_ID,
  META_DEVICE_INSTANCE_ID,
  type BackupCounts,
  type BackupV1,
  type BackupV2,
  type ParsedBackup,
  type RestoreOptions,
  type RestorePreview,
  type ValidationIssue,
  type ValidationResult,
} from './types';

export {
  canonicalPayloadForChecksum,
  computeBackupChecksum,
  sha256Hex,
  stableStringify,
  verifyBackupChecksum,
} from './canonical';

export {
  ensureDataLineageId,
  ensureDeviceInstanceId,
  ensureIdentities,
  getDataLineageId,
  getDeviceInstanceId,
} from './identities';

export { createBackupV2, exportBackupV2Json, getCurrentCounts } from './export';

export { validateBackupInput } from './validate';

export { atomicReplaceRestore, RestoreError } from './restore';

import { getCurrentCounts } from './export';
import { validateBackupInput } from './validate';
import type { RestorePreview, ValidationResult } from './types';

/**
 * Build a restore preview from file content. Never writes to Dexie.
 */
export async function buildRestorePreview(
  fileContent: string,
  prevalidated?: ValidationResult,
): Promise<RestorePreview> {
  const validation = prevalidated ?? (await validateBackupInput(fileContent));
  const currentCounts = await getCurrentCounts();

  if (!validation.ok || !validation.normalized) {
    // Prefer formatVersion from partial parse when possible
    let formatVersion: 1 | 2 = 2;
    try {
      const raw = JSON.parse(fileContent) as { formatVersion?: unknown; version?: unknown };
      if (raw.version === 1) formatVersion = 1;
      else if (raw.formatVersion === 2) formatVersion = 2;
    } catch {
      /* ignore */
    }

    return {
      formatVersion,
      exportedAt: '',
      sourceDeviceInstanceId: null,
      dataLineageId: null,
      counts: { properties: 0, clients: 0, needs: 0, followUps: 0, activities: 0 },
      currentCounts,
      // v2 with checksum issues → false; otherwise null when unparseable
      checksumValid: validation.checksumValid,
      issues: validation.issues,
      canRestore: false,
    };
  }

  const n = validation.normalized;
  return {
    formatVersion: validation.parsed?.kind === 'v1' ? 1 : 2,
    exportedAt: n.exportedAt,
    sourceDeviceInstanceId: n.sourceDeviceInstanceId,
    dataLineageId: n.dataLineageId,
    counts: n.counts,
    currentCounts,
    checksumValid: validation.checksumValid,
    issues: validation.issues,
    canRestore: validation.ok,
  };
}
