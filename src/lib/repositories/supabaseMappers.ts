/**
 * Pure camelCase ↔ snake_case mappers between app domain models and Migration 009 rows.
 * No I/O. Safe for unit tests and browser/server adapters.
 */
import type {
  Activity,
  Client,
  ClientInput,
  FollowUp,
  FollowUpInput,
  FollowUpStatus,
  Need,
  NeedInput,
  Property,
  PropertyInput,
  PropertyType,
  TransactionType,
} from '../../types';

/** RFC 4122 UUID (any version) — required for PostgreSQL uuid columns. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Milliseconds since epoch ↔ ISO / Postgres timestamptz string. */
export function msToIso(ms: number): string {
  return new Date(ms).toISOString();
}

export function isoToMs(value: string | null | undefined): number {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

/** Local calendar date YYYY-MM-DD ↔ Postgres date (same string form). */
export function dueDateToPg(dueDate: string): string {
  return dueDate;
}

export function dueDateFromPg(value: string | null | undefined): string {
  if (!value) return '';
  // Postgres may return "YYYY-MM-DD" or a full timestamp; take date part.
  return value.slice(0, 10);
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Integer-toman / BIGINT fields must stay inside Number.MAX_SAFE_INTEGER.
 * Rejects unsafe values instead of silently rounding (area fields stay on numOrNull).
 */
export function moneyOrNull(value: unknown, field = 'money'): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error(`مقدار ${field} خارج از محدوده امن عدد صحیح است`);
    }
    return Number(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!/^-?\d+$/.test(trimmed)) {
      throw new Error(`مقدار ${field} عدد صحیح معتبر نیست`);
    }
    try {
      return moneyOrNull(BigInt(trimmed), field);
    } catch (e) {
      if (e instanceof Error && e.message.includes('خارج از محدوده')) throw e;
      throw new Error(`مقدار ${field} عدد صحیح معتبر نیست`);
    }
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new Error(`مقدار ${field} خارج از محدوده امن عدد صحیح است`);
    }
    return value;
  }
  throw new Error(`مقدار ${field} عدد صحیح معتبر نیست`);
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** ISO timestamp for update payloads; injectable for tests. */
export function nowIso(atMs: number = Date.now()): string {
  return msToIso(atMs);
}

// --- Property ---

export type PropertyRow = {
  id: string;
  organization_id: string;
  title: string;
  transaction_type: TransactionType;
  property_type: PropertyType;
  area: number | string | null;
  bedrooms: number | null;
  location: string;
  neighborhood: string;
  price: number | string | null;
  deposit: number | string | null;
  rent: number | string | null;
  floor: number | null;
  total_floors: number | null;
  parking: boolean | null;
  elevator: boolean | null;
  storage: boolean | null;
  description: string;
  contact_name: string;
  contact_phone: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export function propertyFromRow(row: PropertyRow): Property {
  return {
    id: row.id,
    title: str(row.title),
    transactionType: row.transaction_type,
    propertyType: row.property_type,
    area: numOrNull(row.area),
    bedrooms: numOrNull(row.bedrooms),
    location: str(row.location),
    neighborhood: str(row.neighborhood),
    price: moneyOrNull(row.price, 'price'),
    deposit: moneyOrNull(row.deposit, 'deposit'),
    rent: moneyOrNull(row.rent, 'rent'),
    floor: numOrNull(row.floor),
    totalFloors: numOrNull(row.total_floors),
    parking: row.parking ?? null,
    elevator: row.elevator ?? null,
    storage: row.storage ?? null,
    description: str(row.description),
    contactName: str(row.contact_name),
    contactPhone: str(row.contact_phone),
    createdAt: isoToMs(row.created_at),
    updatedAt: isoToMs(row.updated_at),
  };
}

/** Insert payload (no id — DB generates UUID). */
export function propertyInsertRow(
  input: PropertyInput,
  orgId: string,
  userId: string,
): Record<string, unknown> {
  return {
    organization_id: orgId,
    title: input.title,
    transaction_type: input.transactionType,
    property_type: input.propertyType,
    area: input.area,
    bedrooms: input.bedrooms,
    location: input.location,
    neighborhood: input.neighborhood,
    price: moneyOrNull(input.price, 'price'),
    deposit: moneyOrNull(input.deposit, 'deposit'),
    rent: moneyOrNull(input.rent, 'rent'),
    floor: input.floor,
    total_floors: input.totalFloors,
    parking: input.parking,
    elevator: input.elevator,
    storage: input.storage,
    description: input.description,
    contact_name: input.contactName,
    contact_phone: input.contactPhone,
    created_by: userId,
    updated_by: userId,
  };
}

export function propertyUpdateRow(
  patch: Partial<PropertyInput>,
  userId: string,
  updatedAtIso: string = nowIso(),
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    updated_by: userId,
    updated_at: updatedAtIso,
  };
  if (patch.title !== undefined) out.title = patch.title;
  if (patch.transactionType !== undefined) out.transaction_type = patch.transactionType;
  if (patch.propertyType !== undefined) out.property_type = patch.propertyType;
  if (patch.area !== undefined) out.area = patch.area;
  if (patch.bedrooms !== undefined) out.bedrooms = patch.bedrooms;
  if (patch.location !== undefined) out.location = patch.location;
  if (patch.neighborhood !== undefined) out.neighborhood = patch.neighborhood;
  if (patch.price !== undefined) out.price = moneyOrNull(patch.price, 'price');
  if (patch.deposit !== undefined) out.deposit = moneyOrNull(patch.deposit, 'deposit');
  if (patch.rent !== undefined) out.rent = moneyOrNull(patch.rent, 'rent');
  if (patch.floor !== undefined) out.floor = patch.floor;
  if (patch.totalFloors !== undefined) out.total_floors = patch.totalFloors;
  if (patch.parking !== undefined) out.parking = patch.parking;
  if (patch.elevator !== undefined) out.elevator = patch.elevator;
  if (patch.storage !== undefined) out.storage = patch.storage;
  if (patch.description !== undefined) out.description = patch.description;
  if (patch.contactName !== undefined) out.contact_name = patch.contactName;
  if (patch.contactPhone !== undefined) out.contact_phone = patch.contactPhone;
  return out;
}

// --- Client ---

export type ClientRow = {
  id: string;
  organization_id: string;
  name: string;
  phone: string;
  notes: string;
  tags: string[] | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export function clientFromRow(row: ClientRow): Client {
  return {
    id: row.id,
    name: str(row.name),
    phone: str(row.phone),
    notes: str(row.notes),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    createdAt: isoToMs(row.created_at),
    updatedAt: isoToMs(row.updated_at),
  };
}

export function clientInsertRow(
  input: ClientInput,
  orgId: string,
  userId: string,
): Record<string, unknown> {
  return {
    organization_id: orgId,
    name: input.name,
    phone: input.phone,
    notes: input.notes,
    tags: input.tags ?? [],
    created_by: userId,
    updated_by: userId,
  };
}

export function clientUpdateRow(
  patch: Partial<ClientInput>,
  userId: string,
  updatedAtIso: string = nowIso(),
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    updated_by: userId,
    updated_at: updatedAtIso,
  };
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.phone !== undefined) out.phone = patch.phone;
  if (patch.notes !== undefined) out.notes = patch.notes;
  if (patch.tags !== undefined) out.tags = patch.tags;
  return out;
}

// --- Need ---

export type NeedRow = {
  id: string;
  organization_id: string;
  client_id: string;
  transaction_type: TransactionType;
  property_type: PropertyType | null;
  min_area: number | string | null;
  max_area: number | string | null;
  bedrooms: number | null;
  location: string;
  max_price: number | string | null;
  max_deposit: number | string | null;
  max_rent: number | string | null;
  notes: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export function needFromRow(row: NeedRow): Need {
  return {
    id: row.id,
    clientId: row.client_id,
    transactionType: row.transaction_type,
    propertyType: row.property_type,
    minArea: numOrNull(row.min_area),
    maxArea: numOrNull(row.max_area),
    bedrooms: numOrNull(row.bedrooms),
    location: str(row.location),
    maxPrice: moneyOrNull(row.max_price, 'max_price'),
    maxDeposit: moneyOrNull(row.max_deposit, 'max_deposit'),
    maxRent: moneyOrNull(row.max_rent, 'max_rent'),
    notes: str(row.notes),
    createdAt: isoToMs(row.created_at),
    updatedAt: isoToMs(row.updated_at),
  };
}

export function needInsertRow(
  input: NeedInput,
  orgId: string,
  userId: string,
): Record<string, unknown> {
  return {
    organization_id: orgId,
    client_id: input.clientId,
    transaction_type: input.transactionType,
    property_type: input.propertyType,
    min_area: input.minArea,
    max_area: input.maxArea,
    bedrooms: input.bedrooms,
    location: input.location,
    max_price: moneyOrNull(input.maxPrice, 'max_price'),
    max_deposit: moneyOrNull(input.maxDeposit, 'max_deposit'),
    max_rent: moneyOrNull(input.maxRent, 'max_rent'),
    notes: input.notes,
    created_by: userId,
    updated_by: userId,
  };
}

export function needUpdateRow(
  patch: Partial<NeedInput>,
  userId: string,
  updatedAtIso: string = nowIso(),
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    updated_by: userId,
    updated_at: updatedAtIso,
  };
  if (patch.clientId !== undefined) out.client_id = patch.clientId;
  if (patch.transactionType !== undefined) out.transaction_type = patch.transactionType;
  if (patch.propertyType !== undefined) out.property_type = patch.propertyType;
  if (patch.minArea !== undefined) out.min_area = patch.minArea;
  if (patch.maxArea !== undefined) out.max_area = patch.maxArea;
  if (patch.bedrooms !== undefined) out.bedrooms = patch.bedrooms;
  if (patch.location !== undefined) out.location = patch.location;
  if (patch.maxPrice !== undefined) out.max_price = moneyOrNull(patch.maxPrice, 'max_price');
  if (patch.maxDeposit !== undefined) out.max_deposit = moneyOrNull(patch.maxDeposit, 'max_deposit');
  if (patch.maxRent !== undefined) out.max_rent = moneyOrNull(patch.maxRent, 'max_rent');
  if (patch.notes !== undefined) out.notes = patch.notes;
  return out;
}

// --- FollowUp ---

export type FollowUpRow = {
  id: string;
  organization_id: string;
  title: string;
  client_id: string;
  property_id: string | null;
  due_date: string;
  status: FollowUpStatus;
  notes: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export function followUpFromRow(row: FollowUpRow): FollowUp {
  return {
    id: row.id,
    title: str(row.title),
    clientId: row.client_id,
    propertyId: row.property_id ?? null,
    dueDate: dueDateFromPg(row.due_date),
    status: row.status,
    notes: str(row.notes),
    createdAt: isoToMs(row.created_at),
    updatedAt: isoToMs(row.updated_at),
  };
}

export function followUpInsertRow(
  input: FollowUpInput,
  orgId: string,
  userId: string,
): Record<string, unknown> {
  return {
    organization_id: orgId,
    title: input.title,
    client_id: input.clientId,
    property_id: input.propertyId,
    due_date: dueDateToPg(input.dueDate),
    status: input.status,
    notes: input.notes,
    created_by: userId,
    updated_by: userId,
  };
}

export function followUpUpdateRow(
  patch: Partial<FollowUpInput>,
  userId: string,
  updatedAtIso: string = nowIso(),
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    updated_by: userId,
    updated_at: updatedAtIso,
  };
  if (patch.title !== undefined) out.title = patch.title;
  if (patch.clientId !== undefined) out.client_id = patch.clientId;
  if (patch.propertyId !== undefined) out.property_id = patch.propertyId;
  if (patch.dueDate !== undefined) out.due_date = dueDateToPg(patch.dueDate);
  if (patch.status !== undefined) out.status = patch.status;
  if (patch.notes !== undefined) out.notes = patch.notes;
  return out;
}

// --- Activity ---

export type ActivityRow = {
  id: string;
  organization_id: string;
  type: Activity['type'];
  text: string;
  created_by: string;
  created_at: string;
};

export function activityFromRow(row: ActivityRow): Activity {
  return {
    id: row.id,
    type: row.type,
    text: str(row.text),
    createdAt: isoToMs(row.created_at),
  };
}

export function activityInsertRow(
  type: Activity['type'],
  text: string,
  orgId: string,
  userId: string,
): Record<string, unknown> {
  return {
    organization_id: orgId,
    type,
    text,
    created_by: userId,
  };
}
