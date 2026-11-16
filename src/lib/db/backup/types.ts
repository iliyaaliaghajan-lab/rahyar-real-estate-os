/**
 * Backup v2 types for local Dexie snapshot + restore.
 * No cloud dependencies.
 */

import type { Activity, Client, FollowUp, Need, Property } from '../../../types';

export const BACKUP_APP = 'rahyar' as const;
export const BACKUP_FORMAT_VERSION = 2 as const;

/** Meta keys managed by identity / lineage. */
export const META_DEVICE_INSTANCE_ID = 'deviceInstanceId' as const;
export const META_DATA_LINEAGE_ID = 'dataLineageId' as const;

export type BusinessStoreName =
  | 'properties'
  | 'clients'
  | 'needs'
  | 'followUps'
  | 'activities';

export const BUSINESS_STORES: readonly BusinessStoreName[] = [
  'properties',
  'clients',
  'needs',
  'followUps',
  'activities',
] as const;

export interface BackupCounts {
  properties: number;
  clients: number;
  needs: number;
  followUps: number;
  activities: number;
}

/**
 * Backup v2 document shape.
 * Checksum covers the canonical form of everything except the checksum field itself.
 */
export interface BackupV2 {
  app: typeof BACKUP_APP;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  /** ISO-8601 export time */
  exportedAt: string;
  /** Persistent device identity that produced this backup (source device). */
  sourceDeviceInstanceId: string;
  /** Data lineage identity at export time. */
  dataLineageId: string;
  counts: BackupCounts;
  properties: Property[];
  clients: Client[];
  needs: Need[];
  followUps: FollowUp[];
  activities: Activity[];
  /** SHA-256 hex of canonical JSON of this object without the checksum field. */
  checksum: string;
}

/** Legacy v1 shape (exportAllData). Accepted for restore with migration path. */
export interface BackupV1 {
  app: 'rahyar';
  version: 1;
  exportedAt: string;
  properties: Property[];
  clients: Client[];
  needs: Need[];
  followUps: FollowUp[];
  activities: Activity[];
}

export type ParsedBackup =
  | { kind: 'v2'; backup: BackupV2 }
  | { kind: 'v1'; backup: BackupV1 };

export interface ValidationIssue {
  path: string;
  message: string;
  code:
    | 'shape'
    | 'type'
    | 'enum'
    | 'duplicate_id'
    | 'fk'
    | 'money'
    | 'timestamp'
    | 'date'
    | 'checksum'
    | 'counts'
    | 'legacy';
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  parsed: ParsedBackup | null;
  /** Normalized v2-ready payload after successful validation (v1 is upgraded). */
  normalized: BackupV2 | null;
  /**
   * For v2: true if checksum matched, false if mismatched or missing.
   * For v1: null (no original checksum).
   * For unparseable: null.
   */
  checksumValid: boolean | null;
}

export interface RestorePreview {
  formatVersion: 1 | 2;
  exportedAt: string;
  sourceDeviceInstanceId: string | null;
  dataLineageId: string | null;
  counts: BackupCounts;
  currentCounts: BackupCounts;
  /** true / false for v2; null for v1 or unparseable */
  checksumValid: boolean | null;
  issues: ValidationIssue[];
  canRestore: boolean;
}

/**
 * Test-only failure injection. Must not affect production paths.
 * Only evaluated inside the restore transaction.
 */
export interface RestoreOptions {
  /** Fail after clearing business stores, before bulkPut. */
  injectFailureAfterClear?: boolean;
  /** Fail after identity meta writes, before transaction commit. */
  injectFailureAfterMeta?: boolean;
}
