# Isolated Postgres — Invitation P0 Security Tests

## Purpose

Close the gap between static/unit contracts and real PostgreSQL behaviour for organization invitation security on branch `feat/etehad-secure-invitations-and-rls` (PR #1).

These tests exercise:

- **Test A** — Expired invitation is rejected (`Invitation expired`); status stays `pending`; no membership row.
- **Test B** — Concurrent accept of the *same* token from two independent connections: exactly one success, one active membership, invitation becomes `accepted`.
- **Test C** — Concurrent accept of *two different* tokens (two orgs, same invitee email): exactly one success; the unique index `idx_org_members_one_active_per_user` (and application checks) ensure a single active membership.

They are **not** a substitute for live Supabase Staging smoke or browser E2E.

## Environment

- Temporary local or CI Postgres only.
- No connection to Supabase, Staging, or Production.
- No real user data, secrets, or service-role keys.

Stubs (`scripts/isolated-pg/00_auth_and_roles.sql`):

- schema `auth` + minimal `auth.users`
- `auth.uid()` / `auth.set_test_uid()` GUC helpers
- roles `anon`, `authenticated`, `service_role`
- `extensions.pgcrypto` for `digest` / token hashing
- minimal business tables so migration “IF EXISTS” paths run

Migrations applied in order (unchanged):

`001` → `002` → `003` → `004` → `005` → `006` → `007`

## How to run

### Local

```bash
export PGHOST=/var/run/postgresql   # or 127.0.0.1
export PGPORT=5432
export PGUSER=postgres
# export PGPASSWORD=...             # if using password auth
export CONCURRENCY_ROUNDS=5

npm run test:db-integration
```

The script creates a throwaway database, applies stubs + migrations, runs A/B/C, then drops the database.

### CI

Workflow: `.github/workflows/isolated-invitation-p0.yml`

- Matrix: Postgres 15 and 16 service containers
- `CONCURRENCY_ROUNDS=5`
- Also runs existing `npm test` unit/static contracts
- No Supabase secrets required

## Success criteria

| Test | Success |
|------|---------|
| A | RPC raises `Invitation expired`; `status = pending`; 0 active memberships for invitee |
| B | Exactly 1 of 2 concurrent accepts succeeds; 1 active membership; invitation `accepted` with correct `accepted_by` |
| C | Exactly 1 of 2 concurrent accepts succeeds; 1 active membership total; 1 invitation `accepted` |

## What these tests do **not** prove

- Live RLS behaviour under Supabase Auth JWT claims
- Frontend fragment-token transport or Strict Mode capture
- Staging/Production migration history or advisor findings
- Email delivery, rate limiting, or browser E2E
- Behaviour under Migration 008 (not present on this branch)

## Safety

- Does not modify `main` or the PR base branch.
- Does not alter any migration SQL (including `007`).
- Does not dispatch Staging workflows or touch remote Supabase projects.
- Temporary database is always dropped on exit.
