# Migration 008 Verification Gate

## Isolated CI vs live Supabase

This branch verifies migration 008 **only** against disposable PostgreSQL containers in GitHub Actions. Success means the migration SQL and the isolated harness behave as designed under controlled fixtures. It does **not** mean Staging or Production catalogs are safe to migrate.

### What isolated CI covers

- Positive scenarios (`safe`, `create`, `setrole`): migration applies; helper is SECURITY DEFINER with empty search_path; public helpers dropped; policies use `private.user_organization_ids`; invitation lockdown; same-session helper smoke.
- Negative scenarios: preflights abort with `SECURITY PREFLIGHT FAILED` and scenario-specific diagnostics.
- `neg_function_owner_preflight_c`: event-trigger fixture injects membership **after** helper create so **preflight C** (not A/B) stops the migration; requires `M008_TEST_C_FIXTURE` marker.
- Static contracts job (Node 22 + `npm test`).
- Summary job gates on matrix **and** contracts; green summary cannot mask a failed job.

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
