# Isolated Postgres — Invitation P0 Security Tests

## Purpose

Close the gap between static/unit contracts and real PostgreSQL behaviour for organization invitation security on branch `feat/etehad-secure-invitations-and-rls` (PR #1).

These tests exercise:

- **Test A** — Expired invitation is rejected (`Invitation expired`); status stays `pending`; no membership row.
- **Test B** — Concurrent accept of the *same* token from two independent connections: exactly one success; the losing connection must raise **`Invitation already accepted`**.
- **Test C** — Concurrent accept of *two different* tokens (two orgs, same invitee email): exactly one success; the loser must hit either the unique index `idx_org_members_one_active_per_user` or the application rejection `User already belongs to another organization`; the losing invitation stays `pending`; `accepted_by` and active membership org match the winner.

They are **not** a substitute for live Supabase Staging smoke or browser E2E.

## Environment

- Temporary local or CI Postgres only.
- No connection to Supabase, Staging, or Production.
- No real user data, secrets, or service-role keys.

Stubs (`scripts/isolated-pg/00_auth_and_roles.sql`):

- schema `auth` + minimal `auth.users`
- `auth.uid()` / `auth.set_test_uid()` GUC helpers (session GUC, not real JWTs)
- roles `anon`, `authenticated`, `service_role`
- `extensions.pgcrypto` for `digest` / token hashing
- minimal business tables so migration “IF EXISTS” paths run

Migrations applied in order (unchanged):

`001` → `002` → `003` → `004` → `005` → `006` → `007`

### Limits of the isolated auth stub

The harness sets `request.jwt.claim.sub` via `auth.set_test_uid()`. It does **not**:

- validate or parse real Supabase Auth JWTs
- exercise Supabase Auth hooks, session cookies, or RLS policies under live JWT claims
- prove behaviour of the hosted Supabase Auth schema beyond the minimal `auth.users` table and `auth.uid()` stub

Passing these tests proves PostgreSQL-level invitation RPC locking, expiration, and the unique active-membership index under concurrent connections. It does **not** prove live Supabase JWT/RLS end-to-end security.

## Local-host-only connection guard

Before any `CREATE DATABASE` / `DROP DATABASE`, the runner:

1. Accepts only loopback hosts (`localhost`, `127.0.0.1`, `::1`) or approved local Unix socket paths (`/var/run/postgresql`, `/run/postgresql`, `/tmp`, and subpaths).
2. If `PGHOSTADDR` is set, accepts only loopback IP addresses.
3. Connects to the root database and queries `inet_server_addr()`. Non-loopback addresses are refused. `NULL` (Unix socket) is allowed.

This is a **best-effort** guard against accidental remote targets. It does **not** protect against a local tunnel or proxy that presents as loopback (e.g. SSH local port forward to a remote Postgres). Operators must still ensure the target is a temporary test instance.

### GitHub Actions service-container exception

In CI, the job connects with `PGHOST=127.0.0.1` (port publish), but PostgreSQL reports `inet_server_addr()` as the **container-side** address (e.g. `172.18.0.2`). The workflow therefore:

1. Reads `${{ job.services.postgres.id }}` (the exact service container for this job).
2. Runs `docker inspect` to obtain that container’s IPv4 address.
3. Exports `P0_ALLOWED_SERVER_ADDR=<that IP>` and `P0_ALLOW_SERVICE_CONTAINER=1` via `$GITHUB_ENV`.

The runner accepts a non-loopback `inet_server_addr()` **only** when all of these hold:

- `GITHUB_ACTIONS=true`
- `P0_ALLOW_SERVICE_CONTAINER=1`
- `PGHOST` is loopback (preferably `127.0.0.1`)
- `PGHOSTADDR` is empty or loopback
- `inet_server_addr()` equals `P0_ALLOWED_SERVER_ADDR` **exactly**

Arbitrary private/RFC1918 ranges are **not** allowed. Setting `P0_ALLOWED_SERVER_ADDR` without the opt-in flag does not bypass the guard.

On refusal the script exits with a clear message and does not print secrets (passwords, tokens, or connection strings with credentials).

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
- `pull_request` filter targets the PR **base** branch `fix/staging-security-audit-v2`
- Minimal permissions: `contents: read`
- Resolves exact service container IP via `job.services.postgres.id` + `docker inspect`

## Success criteria

| Test | Success |
|------|---------|
| A | RPC raises `Invitation expired`; `status = pending`; 0 active memberships for invitee |
| B | Exactly 1 of 2 concurrent accepts succeeds; **loser error is exactly `Invitation already accepted`**; 1 active membership; invitation `accepted` with correct `accepted_by` |
| C | Exactly 1 of 2 concurrent accepts succeeds; loser error is unique-index violation **or** `User already belongs to another organization`; losing invitation stays `pending`; winner `accepted_by` = invitee; active membership org = accepted invitation org |

Each concurrent scenario is repeated `CONCURRENCY_ROUNDS` times with fresh random data and independent PostgreSQL connections (not sequential calls).

## What these tests do **not** prove

- Live RLS behaviour under Supabase Auth JWT claims
- Frontend fragment-token transport or Strict Mode capture
- Staging/Production migration history or advisor findings
- Email delivery, rate limiting, or browser E2E
- Behaviour under Migration 008 (not present on this branch)
- Protection against a localhost tunnel to a remote database

## Safety

- Does not modify `main` or the PR base branch.
- Does not alter any migration SQL (including `007`).
- Does not dispatch Staging workflows or touch remote Supabase projects.
- Temporary database is always dropped on exit (only after the local-host safety checks pass).
