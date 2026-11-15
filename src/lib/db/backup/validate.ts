/**
 * Strict validation of backup JSON (v1 and v2).
 * Does not write to Dexie. Does not silently discard malformed rows.
 */

import { verifyBackupChecksum, computeBackupChecksum } from './canonical';
import {
  BACKUP_APP,
  BACKUP_FORMAT_VERSION,
  type BackupCounts,
  type BackupV1,
  type BackupV2,
  type ParsedBackup,
  type ValidationIssue,
  type ValidationResult,
} from './types';
import type { Activity, Client, FollowUp, Need, Property } from '../../../types';

const TRANSACTION_TYPES = new Set(['sale', 'rent']);
const PROPERTY_TYPES = new Set(['apartment', 'house', 'land', 'shop', 'office', 'other']);
const FOLLOWUP_STATUSES = new Set(['pending', 'completed']);
const ACTIVITY_TYPES = new Set(['property', 'client', 'need', 'followup']);

function isSafeIntegerMoney(n: unknown): n is number | null {
  if (n === null) return true;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
}

function isTimestamp(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** YYYY-MM-DD that is a real calendar date. */
function isCalendarDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Strict UTC timestamp matching Date.prototype.toISOString():
 * YYYY-MM-DDTHH:mm:ss.sssZ
 * Rejects empty, non-string, missing Z, invalid calendar components, and
 * values that only parse loosely with Date.
 */
function isIsoUtcTimestamp(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  // Exact shape produced by toISOString()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const mo = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  const h = Number(s.slice(11, 13));
  const mi = Number(s.slice(14, 16));
  const se = Number(s.slice(17, 19));
  const ms = Number(s.slice(20, 23));
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > 31) return false;
  if (h > 23 || mi > 59 || se > 59) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, se, ms));
  if (Number.isNaN(dt.getTime())) return false;
  // Round-trip: must equal the canonical toISOString form
  return dt.toISOString() === s;
}

function isNonEmptyString(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0;
}

function isString(s: unknown): s is string {
  return typeof s === 'string';
}

function push(issues: ValidationIssue[], path: string, message: string, code: ValidationIssue['code']) {
  issues.push({ path, message, code });
}

function validateProperty(p: unknown, path: string, issues: ValidationIssue[], ids: Set<string>): void {
  if (!p || typeof p !== 'object') {
    push(issues, path, 'must be an object', 'shape');
    return;
  }
  const r = p as Record<string, unknown>;
  if (!isNonEmptyString(r.id)) push(issues, `${path}.id`, 'required non-empty string', 'type');
  else if (ids.has(r.id)) push(issues, `${path}.id`, 'duplicate id', 'duplicate_id');
  else ids.add(r.id);

  if (!isString(r.title)) push(issues, `${path}.title`, 'must be string', 'type');
  if (!TRANSACTION_TYPES.has(r.transactionType as string))
    push(issues, `${path}.transactionType`, 'invalid enum', 'enum');
  if (!PROPERTY_TYPES.has(r.propertyType as string))
    push(issues, `${path}.propertyType`, 'invalid enum', 'enum');
  for (const f of ['area', 'bedrooms', 'floor', 'totalFloors'] as const) {
    if (r[f] !== null && (typeof r[f] !== 'number' || !Number.isFinite(r[f] as number)))
      push(issues, `${path}.${f}`, 'must be number or null', 'type');
  }
  for (const f of ['price', 'deposit', 'rent'] as const) {
    if (!isSafeIntegerMoney(r[f]))
      push(issues, `${path}.${f}`, 'must be safe non-negative integer or null', 'money');
  }
  for (const f of ['location', 'neighborhood', 'description', 'contactName', 'contactPhone'] as const) {
    if (!isString(r[f])) push(issues, `${path}.${f}`, 'must be string', 'type');
  }
  for (const f of ['parking', 'elevator', 'storage'] as const) {
    if (r[f] !== null && typeof r[f] !== 'boolean')
      push(issues, `${path}.${f}`, 'must be boolean or null', 'type');
  }
  if (!isTimestamp(r.createdAt)) push(issues, `${path}.createdAt`, 'invalid timestamp', 'timestamp');
  if (!isTimestamp(r.updatedAt)) push(issues, `${path}.updatedAt`, 'invalid timestamp', 'timestamp');
}

function validateClient(c: unknown, path: string, issues: ValidationIssue[], ids: Set<string>): void {
  if (!c || typeof c !== 'object') {
    push(issues, path, 'must be an object', 'shape');
    return;
  }
  const r = c as Record<string, unknown>;
  if (!isNonEmptyString(r.id)) push(issues, `${path}.id`, 'required non-empty string', 'type');
  else if (ids.has(r.id)) push(issues, `${path}.id`, 'duplicate id', 'duplicate_id');
  else ids.add(r.id);
  if (!isString(r.name)) push(issues, `${path}.name`, 'must be string', 'type');
  if (!isString(r.phone)) push(issues, `${path}.phone`, 'must be string', 'type');
  if (!isString(r.notes)) push(issues, `${path}.notes`, 'must be string', 'type');
  if (!Array.isArray(r.tags) || !r.tags.every((t) => typeof t === 'string'))
    push(issues, `${path}.tags`, 'must be string[]', 'type');
  if (!isTimestamp(r.createdAt)) push(issues, `${path}.createdAt`, 'invalid timestamp', 'timestamp');
  if (!isTimestamp(r.updatedAt)) push(issues, `${path}.updatedAt`, 'invalid timestamp', 'timestamp');
}

function validateNeed(
  n: unknown,
  path: string,
  issues: ValidationIssue[],
  ids: Set<string>,
  clientIds: Set<string>,
): void {
  if (!n || typeof n !== 'object') {
    push(issues, path, 'must be an object', 'shape');
    return;
  }
  const r = n as Record<string, unknown>;
  if (!isNonEmptyString(r.id)) push(issues, `${path}.id`, 'required non-empty string', 'type');
  else if (ids.has(r.id)) push(issues, `${path}.id`, 'duplicate id', 'duplicate_id');
  else ids.add(r.id);
  if (!isNonEmptyString(r.clientId)) push(issues, `${path}.clientId`, 'required string', 'type');
  else if (!clientIds.has(r.clientId))
    push(issues, `${path}.clientId`, 'foreign key: client not found', 'fk');
  if (!TRANSACTION_TYPES.has(r.transactionType as string))
    push(issues, `${path}.transactionType`, 'invalid enum', 'enum');
  if (r.propertyType !== null && !PROPERTY_TYPES.has(r.propertyType as string))
    push(issues, `${path}.propertyType`, 'invalid enum or null', 'enum');
  for (const f of ['minArea', 'maxArea', 'bedrooms'] as const) {
    if (r[f] !== null && (typeof r[f] !== 'number' || !Number.isFinite(r[f] as number)))
      push(issues, `${path}.${f}`, 'must be number or null', 'type');
  }
  for (const f of ['maxPrice', 'maxDeposit', 'maxRent'] as const) {
    if (!isSafeIntegerMoney(r[f]))
      push(issues, `${path}.${f}`, 'must be safe non-negative integer or null', 'money');
  }
  if (!isString(r.location)) push(issues, `${path}.location`, 'must be string', 'type');
  if (!isString(r.notes)) push(issues, `${path}.notes`, 'must be string', 'type');
  if (!isTimestamp(r.createdAt)) push(issues, `${path}.createdAt`, 'invalid timestamp', 'timestamp');
  if (!isTimestamp(r.updatedAt)) push(issues, `${path}.updatedAt`, 'invalid timestamp', 'timestamp');
}

function validateFollowUp(
  f: unknown,
  path: string,
  issues: ValidationIssue[],
  ids: Set<string>,
  clientIds: Set<string>,
  propertyIds: Set<string>,
): void {
  if (!f || typeof f !== 'object') {
    push(issues, path, 'must be an object', 'shape');
    return;
  }
  const r = f as Record<string, unknown>;
  if (!isNonEmptyString(r.id)) push(issues, `${path}.id`, 'required non-empty string', 'type');
  else if (ids.has(r.id)) push(issues, `${path}.id`, 'duplicate id', 'duplicate_id');
  else ids.add(r.id);
  if (!isString(r.title)) push(issues, `${path}.title`, 'must be string', 'type');
  if (!isNonEmptyString(r.clientId)) push(issues, `${path}.clientId`, 'required string', 'type');
  else if (!clientIds.has(r.clientId))
    push(issues, `${path}.clientId`, 'foreign key: client not found', 'fk');
  if (r.propertyId !== null) {
    if (!isNonEmptyString(r.propertyId))
      push(issues, `${path}.propertyId`, 'must be string or null', 'type');
    else if (!propertyIds.has(r.propertyId))
      push(issues, `${path}.propertyId`, 'foreign key: property not found', 'fk');
  }
  if (!isCalendarDate(r.dueDate)) push(issues, `${path}.dueDate`, 'invalid calendar date YYYY-MM-DD', 'date');
  if (!FOLLOWUP_STATUSES.has(r.status as string))
    push(issues, `${path}.status`, 'invalid enum', 'enum');
  if (!isString(r.notes)) push(issues, `${path}.notes`, 'must be string', 'type');
  if (!isTimestamp(r.createdAt)) push(issues, `${path}.createdAt`, 'invalid timestamp', 'timestamp');
  if (!isTimestamp(r.updatedAt)) push(issues, `${path}.updatedAt`, 'invalid timestamp', 'timestamp');
}

function validateActivity(a: unknown, path: string, issues: ValidationIssue[], ids: Set<string>): void {
  if (!a || typeof a !== 'object') {
    push(issues, path, 'must be an object', 'shape');
    return;
  }
  const r = a as Record<string, unknown>;
  if (!isNonEmptyString(r.id)) push(issues, `${path}.id`, 'required non-empty string', 'type');
  else if (ids.has(r.id)) push(issues, `${path}.id`, 'duplicate id', 'duplicate_id');
  else ids.add(r.id);
  if (!ACTIVITY_TYPES.has(r.type as string)) push(issues, `${path}.type`, 'invalid enum', 'enum');
  if (!isString(r.text)) push(issues, `${path}.text`, 'must be string', 'type');
  if (!isTimestamp(r.createdAt)) push(issues, `${path}.createdAt`, 'invalid timestamp', 'timestamp');
}

function asArray(v: unknown, path: string, issues: ValidationIssue[]): unknown[] {
  if (!Array.isArray(v)) {
    push(issues, path, 'must be an array', 'shape');
    return [];
  }
  return v;
}

function countsMatch(
  counts: BackupCounts,
  properties: unknown[],
  clients: unknown[],
  needs: unknown[],
  followUps: unknown[],
  activities: unknown[],
  issues: ValidationIssue[],
): void {
  if (counts.properties !== properties.length)
    push(issues, 'counts.properties', `expected ${properties.length}`, 'counts');
  if (counts.clients !== clients.length)
    push(issues, 'counts.clients', `expected ${clients.length}`, 'counts');
  if (counts.needs !== needs.length)
    push(issues, 'counts.needs', `expected ${needs.length}`, 'counts');
  if (counts.followUps !== followUps.length)
    push(issues, 'counts.followUps', `expected ${followUps.length}`, 'counts');
  if (counts.activities !== activities.length)
    push(issues, 'counts.activities', `expected ${activities.length}`, 'counts');
}

/**
 * Parse and strictly validate a backup JSON string or object.
 * Never writes to Dexie.
 */
export async function validateBackupInput(input: unknown): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];

  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      return {
        ok: false,
        issues: [{ path: '', message: 'invalid JSON', code: 'shape' }],
        parsed: null,
        normalized: null,
        checksumValid: null,
      };
    }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      issues: [{ path: '', message: 'root must be an object', code: 'shape' }],
      parsed: null,
      normalized: null,
      checksumValid: null,
    };
  }

  const root = raw as Record<string, unknown>;
  if (root.app !== BACKUP_APP) {
    push(issues, 'app', `expected "${BACKUP_APP}"`, 'shape');
  }

  // ---- v2 path ----
  if (root.formatVersion === BACKUP_FORMAT_VERSION) {
    if (!isIsoUtcTimestamp(root.exportedAt))
      push(issues, 'exportedAt', 'must be ISO UTC YYYY-MM-DDTHH:mm:ss.sssZ', 'timestamp');
    if (!isNonEmptyString(root.sourceDeviceInstanceId))
      push(issues, 'sourceDeviceInstanceId', 'required string', 'type');
    if (!isNonEmptyString(root.dataLineageId))
      push(issues, 'dataLineageId', 'required string', 'type');
    if (!root.counts || typeof root.counts !== 'object')
      push(issues, 'counts', 'required object', 'shape');

    const properties = asArray(root.properties, 'properties', issues);
    const clients = asArray(root.clients, 'clients', issues);
    const needs = asArray(root.needs, 'needs', issues);
    const followUps = asArray(root.followUps, 'followUps', issues);
    const activities = asArray(root.activities, 'activities', issues);

    const propertyIds = new Set<string>();
    const clientIds = new Set<string>();
    const needIds = new Set<string>();
    const followUpIds = new Set<string>();
    const activityIds = new Set<string>();

    properties.forEach((p, i) => validateProperty(p, `properties[${i}]`, issues, propertyIds));
    clients.forEach((c, i) => validateClient(c, `clients[${i}]`, issues, clientIds));
    needs.forEach((n, i) => validateNeed(n, `needs[${i}]`, issues, needIds, clientIds));
    followUps.forEach((f, i) =>
      validateFollowUp(f, `followUps[${i}]`, issues, followUpIds, clientIds, propertyIds),
    );
    activities.forEach((a, i) => validateActivity(a, `activities[${i}]`, issues, activityIds));

    if (root.counts && typeof root.counts === 'object') {
      const c = root.counts as BackupCounts;
      countsMatch(c, properties, clients, needs, followUps, activities, issues);
    }

    if (typeof root.checksum !== 'string' || root.checksum.length !== 64)
      push(issues, 'checksum', 'must be 64-char hex SHA-256', 'checksum');

    const backupCandidate = root as unknown as BackupV2;
    let checksumValid: boolean | null = null;
    if (typeof root.checksum === 'string' && root.checksum.length === 64) {
      try {
        checksumValid = await verifyBackupChecksum(backupCandidate);
        if (!checksumValid) {
          push(issues, 'checksum', 'checksum mismatch (payload altered)', 'checksum');
        }
      } catch (err) {
        push(
          issues,
          'checksum',
          err instanceof Error ? err.message : 'checksum computation failed',
          'checksum',
        );
        checksumValid = false;
      }
    } else {
      // missing/invalid shape already pushed; mark checksum invalid for v2
      checksumValid = false;
    }

    const ok = issues.length === 0;
    const parsed: ParsedBackup | null = ok
      ? { kind: 'v2', backup: backupCandidate }
      : null;
    return {
      ok,
      issues,
      parsed,
      normalized: ok ? backupCandidate : null,
      checksumValid,
    };
  }

  // ---- v1 legacy path ----
  if (root.version === 1) {
    const properties = asArray(root.properties, 'properties', issues);
    const clients = asArray(root.clients, 'clients', issues);
    const needs = asArray(root.needs, 'needs', issues);
    const followUps = asArray(root.followUps, 'followUps', issues);
    const activities = asArray(root.activities, 'activities', issues);

    const propertyIds = new Set<string>();
    const clientIds = new Set<string>();
    const needIds = new Set<string>();
    const followUpIds = new Set<string>();
    const activityIds = new Set<string>();

    properties.forEach((p, i) => validateProperty(p, `properties[${i}]`, issues, propertyIds));
    clients.forEach((c, i) => validateClient(c, `clients[${i}]`, issues, clientIds));
    needs.forEach((n, i) => validateNeed(n, `needs[${i}]`, issues, needIds, clientIds));
    followUps.forEach((f, i) =>
      validateFollowUp(f, `followUps[${i}]`, issues, followUpIds, clientIds, propertyIds),
    );
    activities.forEach((a, i) => validateActivity(a, `activities[${i}]`, issues, activityIds));

    if (!isIsoUtcTimestamp(root.exportedAt))
      push(issues, 'exportedAt', 'must be ISO UTC YYYY-MM-DDTHH:mm:ss.sssZ', 'timestamp');

    const ok = issues.length === 0;
    if (!ok) {
      return { ok: false, issues, parsed: null, normalized: null, checksumValid: null };
    }

    const v1 = root as unknown as BackupV1;
    // Upgrade to v2 shape for restore (synthetic identities + checksum).
    const counts: BackupCounts = {
      properties: properties.length,
      clients: clients.length,
      needs: needs.length,
      followUps: followUps.length,
      activities: activities.length,
    };
    const withoutChecksum: Omit<BackupV2, 'checksum'> = {
      app: BACKUP_APP,
      formatVersion: BACKUP_FORMAT_VERSION,
      exportedAt: v1.exportedAt,
      sourceDeviceInstanceId: 'legacy-v1-unknown',
      dataLineageId: `legacy-v1-${v1.exportedAt}`,
      counts,
      properties: properties as Property[],
      clients: clients as Client[],
      needs: needs as Need[],
      followUps: followUps as FollowUp[],
      activities: activities as Activity[],
    };
    const checksum = await computeBackupChecksum(withoutChecksum);
    const normalized: BackupV2 = { ...withoutChecksum, checksum };

    return {
      ok: true,
      issues: [],
      parsed: { kind: 'v1', backup: v1 },
      normalized,
      checksumValid: null, // v1 has no original checksum
    };
  }

  push(
    issues,
    'formatVersion|version',
    'unsupported backup format (expected formatVersion 2 or version 1)',
    'legacy',
  );
  return { ok: false, issues, parsed: null, normalized: null, checksumValid: null };
}
