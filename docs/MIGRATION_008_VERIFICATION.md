# Migration 008 — Isolated verification status

**Branch:** `verify/migration-008-isolated-postgres` only.  
**Migration file:** `supabase/migrations/008_rls_helper_schema_and_profile_policy_optimization.sql` (authored; not applied live by this work).

## What isolated CI proves

The workflow `.github/workflows/verify-migration-008-isolated-postgres.yml` runs disposable PostgreSQL 15/16/17 containers and a Node 22 static-contract job.

| Layer | Coverage |
|-------|----------|
| Positive matrix (`safe`, `create`, `setrole`) | Migration applies; private helper is SECURITY DEFINER; public helpers dropped; policies reference `private.user_organization_ids`; invitation SELECT locked; trigger + helper smoke in one session |
| Negative matrix | Preflights abort with `SECURITY PREFLIGHT FAILED` and scenario-specific diagnostics |
| `neg_function_owner_preflight_c` | Event-trigger fixture injects membership **after** helper create so **preflight C** (not A/B) stops the migration |
| Static contracts | Migration SQL shape, harness scenario presence, workflow matrix, read-only preflight file rules |

Isolated CI success is **not** evidence that Staging or Production catalogs are safe.

## Baseline and expanded matrix

| Run | SHA | Cells | Result |
|-----|-----|-------|--------|
| [40606719695](https://github.com/iliyaaliaghajan-lab/rahyar-real-estate-os/actions/runs/40606719695) | `edc80ff270ac2c68070745fa9e013dc8d3da5e19` | 21 (7 scenarios × 3 PG versions) | Passed |
| Latest expanded run on this branch | current HEAD after preflight-C expansion | **24** (8 scenarios × 3 PG versions) + contracts job | **Authority for current result** |

## Read-only live inventory (not executed by this task)

File: `docs/MIGRATION_008_READ_ONLY_PREFLIGHT.sql`

- Begins `BEGIN TRANSACTION READ ONLY;` and ends `ROLLBACK;`
- SELECT-only diagnostic inventory
- **Not run** against any live Supabase project by this verification work

Manual Dashboard gate (required before any live apply):

- Confirm schema `private` is **absent** from Project Settings → API → Exposed schemas
- Absence of a manual `pgrst.db_schemas` role override does **not** prove the Dashboard-managed list is correct

## Policy and RLS caveats

- Migration **001** enables RLS on business tables only if those tables exist when 001 runs
- Migration **008** creates/rewrites dynamic tenant policies but **does not** itself `ENABLE ROW LEVEL SECURITY`
- Migration 008 only drops **specifically named** policies; unexpected permissive policies may remain and widen access — review **all** policies from the read-only inventory
- Staging history recorded migration **006 applied after 007**; never rewrite migration history to match filenames

## Authorization boundary

This work does **not** authorize:

- a live migration apply
- a pull request or merge
- changes to `main` or feature branches
- production actions or project setting changes
