# Isolated Postgres — Invitation P0 + Tenant Isolation (Integration)

## Purpose

On the PR #4 integration branch (`ai/etehad-integration-dryrun-20261030`), exercise:

1. **Invitation P0** (A/B/C) — expiration and concurrent accept races.
2. **Tenant isolation matrix** (T1–T6) — RLS on the five business tables under the canonical eight-migration chain including Migration 008.

These tests use a disposable local/CI Postgres only. They are **not** live Supabase JWT/RLS or browser E2E proofs.

## Migration chain (Staging chronology)

Applied in this exact order (007 content before 006 content, then 008):

1. `20261022230848_initial_multitenant.sql`
2. `20261022230858_business_tables_rls.sql`
3. `20261022230904_secure_org_policies.sql`
4. `20261022230911_default_privs_and_profile.sql`
5. `20261022230925_organization_invitations.sql`
6. `20261026115345_secure_invitation_privacy_and_validation.sql`
7. `20261027003152_invite_fk_indexes_and_single_org_create.sql`
8. `20261029181022_rls_helper_schema_and_profile_policy_optimization.sql`

Migration SQL is **not** modified by this harness.

## Local-host-only connection guard

Before any `CREATE`/`DROP DATABASE`:

- `PGHOST` must be loopback or an approved Unix socket path.
- `PGHOSTADDR`, if set, must be loopback.
- `inet_server_addr()` must be NULL (socket), loopback, or — under explicit CI opt-in only — equal to the exact IP of this job’s postgres service container (`job.services.postgres.id` + `docker inspect`).

No RFC1918 range open. Localhost tunnels remain outside the protection guarantee.

## Invitation P0 (A/B/C)

| Test | Success |
|------|---------|
| A | `Invitation expired`; status stays `pending` |
| B | Exactly one concurrent same-token accept; loser raises `Invitation already accepted` |
| C | Exactly one of two org tokens accepted; loser unique-index or app rejection; pending loser; `accepted_by`/org match |

## Tenant isolation (T1–T6)

Tables: `properties`, `clients`, `needs`, `follow_ups`, `activities`.

| Test | Success |
|------|---------|
| T1 | Each owner SELECTs only own-tenant rows (count=1 per table) |
| T2 | Cross-tenant INSERT rejected by RLS |
| T3 | Cross-tenant UPDATE affects 0 rows; org_id move prevented |
| T4 | Cross-tenant DELETE affects 0 rows; foreign rows remain |
| T5 | Own-tenant CRUD works; peer isolation holds |
| T6 | Authenticated cannot insert org/membership, change peer role, or delete peer membership |

Operations under test run as role `authenticated` with `auth.set_test_uid()`.

## Migration 008 checks (local)

- `private.user_organization_ids()` exists
- Legacy `public.user_organization_ids` / `public.user_active_organization_ids` absent
- `anon` / `authenticated` lack `CREATE` on schema `private`
- Tenant policies still enforce isolation after helper move

**Not verified here:** hosted Supabase Data API exposed-schemas list (whether `private` is excluded from the API).

## How to run

```bash
export PGHOST=/var/run/postgresql   # or 127.0.0.1
export PGPORT=5432
export PGUSER=postgres
npm run test:db-integration
```

## CI

Workflow: `.github/workflows/isolated-invitation-p0.yml`

- Matrix PG 15 / 16
- Invitation P0 + Tenant isolation per job
- `contents: read`
- No Supabase secrets

## Safety

- Does not modify `main`, base branch, or PRs #1–#3
- Does not alter migration SQL
- Does not touch Staging or Production
