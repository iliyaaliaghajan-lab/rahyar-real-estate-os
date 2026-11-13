# Cloud Data Foundation (Migration 009)

Remote version on **etehad-staging**: `20261112121112` (`cloud_business_data_foundation_009`).

Git file: `supabase/migrations/20261112121112_cloud_business_data_foundation_009.sql`

## Purpose

Create PostgreSQL tables for multi-tenant cloud storage of:

- `properties`
- `clients`
- `needs`
- `follow_ups`
- `activities`

Column shapes follow `src/types/index.ts` (Dexie models), plus tenant/audit fields required for cloud RLS.

## What this does not do

- Does not migrate or delete Dexie / IndexedDB data.
- Does not wire UI or repositories to Supabase.
- Does not apply migrations to Production.
- Does not change invitation RPCs or membership tables.

## Security model

- RLS enabled on all five tables.
- Membership via `private.user_organization_ids()` (active members only).
- `anon`: no table privileges.
- `authenticated`: DML under RLS; `activities` is **SELECT + INSERT only** (append-only).
- `organization_id` cannot change after insert (trigger `private.prevent_organization_id_change`).
- Composite foreign keys keep `needs` and `follow_ups` inside the same organization as their parent client.

## Phase-1 membership rule

Partial unique index `idx_org_members_one_active_per_user`: at most one **active** membership per user. Dual-active membership is intentionally blocked.

## Local verification

```bash
# Requires local Postgres only (script refuses remote hosts)
./scripts/isolated-pg/run_cloud_data_p0.sh
./scripts/isolated-pg/run_tenant_isolation_p0.sh
```

## Migration 010 (FK covering indexes)

File: `supabase/migrations/20261112140000_cloud_business_foreign_key_indexes_010.sql`

Adds `CREATE INDEX IF NOT EXISTS` on FK/audit columns (`created_by`, `updated_by`, `follow_ups.property_id`) not covered in 009. Does not change data, RLS, or grants. **Not applied to Staging/Production from this PR alone.**

## Follow-ups (out of scope here)

- Repository adapters and dual-write / import from Dexie
- Conflict resolution and offline sync
- Hosted Supabase JWT/Data API verification
