# Cloud Data Foundation (Migration 009)

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
- Does not apply migrations to Staging or Production.
- Does not change invitation RPCs or membership tables.

## Security model

- RLS enabled on all five tables.
- Membership via `private.user_organization_ids()` (active members only).
- `anon`: no table privileges.
- `authenticated`: DML under RLS; `activities` is **SELECT + INSERT only** (append-only).
- `organization_id` cannot change after insert (trigger `private.prevent_organization_id_change`).
- Composite foreign keys keep `needs` and `follow_ups` inside the same organization as their parent client/property.

## Local verification

```bash
# Requires local Postgres only (script refuses remote hosts)
./scripts/isolated-pg/run_cloud_data_p0.sh
./scripts/isolated-pg/run_tenant_isolation_p0.sh
```

## Follow-ups (out of scope here)

- Repository adapters and dual-write / import from Dexie
- Conflict resolution and offline sync
- Hosted Supabase JWT/Data API verification
