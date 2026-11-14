/**
 * Deterministic canonical JSON + SHA-256 for backup integrity.
 * Uses Web Crypto API (browser + modern Node). No Node 'crypto' module.
 * Changing any covered field must change the checksum.
 */

import type { BackupV2 } from './types';

/**
 * Stable stringify: object keys sorted recursively; arrays preserve order;
 * numbers/booleans/null as JSON; undefined omitted.
 *
 * Objects are rebuilt with Object.create(null) so keys like "__proto__"
 * are treated as ordinary data and never dropped from the checksum surface.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const obj = value as Record<string, unknown>;
  // Null-prototype object: "__proto__" is a normal own property, not a setter.
  const sorted: Record<string, unknown> = Object.create(null);
  for (const k of Object.keys(obj).sort()) {
    if (obj[k] !== undefined) {
      sorted[k] = canonicalize(obj[k]);
    }
  }
  return sorted;
}

/**
 * Payload used for checksum: full BackupV2 without the checksum field.
 * Includes app, formatVersion, exportedAt, identities, counts, and all records.
 */
export function canonicalPayloadForChecksum(
  backup: Omit<BackupV2, 'checksum'> | BackupV2,
): string {
  const { checksum: _ignored, ...rest } = backup as BackupV2 & { checksum?: string };
  return stableStringify(rest);
}

function bytesToHex(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let hex = '';
  for (let i = 0; i < view.length; i++) {
    hex += view[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * SHA-256 hex via Web Crypto (globalThis.crypto.subtle).
 * Throws a clear error if Web Crypto is unavailable — never silently skip integrity.
 */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') {
    throw new Error(
      'Web Crypto API (crypto.subtle.digest) is unavailable; cannot compute backup checksum',
    );
  }
  const data = new TextEncoder().encode(text);
  const digest = await subtle.digest('SHA-256', data);
  return bytesToHex(digest);
}

export async function computeBackupChecksum(
  backup: Omit<BackupV2, 'checksum'> | BackupV2,
): Promise<string> {
  return sha256Hex(canonicalPayloadForChecksum(backup));
}

export async function verifyBackupChecksum(backup: BackupV2): Promise<boolean> {
  const expected = await computeBackupChecksum(backup);
  return expected === backup.checksum;
}
