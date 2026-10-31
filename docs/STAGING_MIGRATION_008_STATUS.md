# Staging Migration 008 — recorded status

This document is a **status log**, not an apply runbook. It does **not** execute
SQL. Distinguish three facts that must not be conflated:

1. **Git presence** — the executable file
   `supabase/migrations/20261029181022_rls_helper_schema_and_profile_policy_optimization.sql`
   exists in this branch.
   Git presence alone neither proves that a migration was applied in an environment nor authorizes applying it.
   The migration SQL header’s “authored only” wording is apply-authorization hygiene for the Git tree, not a denial that Staging history was observed earlier.
2. **Recorded Staging history** — a prior read-only observation reported version
   `20261029181022` in Staging `supabase_migrations.schema_migrations` (see table
   below). That is history evidence from an earlier review window, not a new proof
   produced on PR #4 HEAD (`5e65656224d356e9895f2381baa31625f539295e`).
3. **Live schema effects** — objects/policies/grants on the Staging database, and
   Data API exposed-schema settings, as reported in that same earlier window.
   **PR #4 did not independently re-verify** those live effects.

**Production migration history remains unverified.**

## Target environment

| Field | Value |
|-------|--------|
| Supabase project name | etehad-staging |
| Project ref | `dezonafotwyvvghbccko` |
| Environment | Staging only |
| Production | Not targeted |

## Migration identity

| Field | Value |
|-------|--------|
| Canonical repository filename | `supabase/migrations/20261029181022_rls_helper_schema_and_profile_policy_optimization.sql` |
| SQL blob SHA (source of truth) | `43621e6b75d83f08ce65db168116b39188dfc23b` |
| Source branch for SQL | `verify/migration-008-isolated-postgres-recovered` / PR3 reconciliation |
| Version previously reported in Staging `supabase_migrations.schema_migrations` | `20261029181022` |

### Filename vs timestamp version

The repository now keeps a **single** executable copy under the timestamp
filename that matches Staging `schema_migrations` version `20261029181022`.
The sequential name `008_rls_helper_schema_and_profile_policy_optimization.sql`
is **not** retained in the executable migration directory.

This document is **repository history reconciliation**, not a fresh migration
application. No SQL is executed by registering this file. **Production
migration history remains unverified.**

## What Migration 008 does (summary)

- Creates schema `private` and helper `private.user_organization_ids()`.
- Reworks organization / membership / profile SELECT policies to use the private helper.
- Optionally applies tenant-isolation policies on business tables **if** those tables exist.
- Drops `public.user_organization_ids()` and `public.user_active_organization_ids()`.
- Revokes API-role privileges on `organization_invitations`.
- Does **not** change bodies/signatures of:
  - `public.create_organization_with_owner`
  - `public.create_organization_invitation`
  - `public.accept_organization_invitation`

## Documented Staging state (reported earlier; not re-verified on PR #4 HEAD)

The following items were **reported** from a prior live Staging review and
security smoke (see run metadata below). They are retained as historical audit
notes. They are **not** claims that this integration HEAD re-queried Staging SQL,
Dashboard exposure settings, or row counts.
Items that the earlier automation could not re-query via SQL were marked
appropriately in that mission report; the owner dashboard checks of 2026-10-29
are cited as the source for exposure settings from that window only.

- Schema `private` exists.
- Legacy public helper functions above were removed from `public`.
- Core tables `organizations`, `profiles`, `organization_members`,
  `organization_invitations` have RLS enabled.
- Direct Data API access to `organization_invitations` is restricted (confirmed
  empirically by staging security smoke L1 tests).
- **Exposed schemas (Dashboard, 2026-10-29, project owner):** `public` and
  `graphql_public` are listed; **`private` is not** listed as exposed.
- Business tables `properties`, `clients`, `needs`, `follow_ups`, `activities`
  were **absent** on Staging at review time. Migration 008 does not create them
  and does not connect the application frontend to Supabase.
- Row counts on the four core tables after the security smoke run were **zero**
  at the time of that review (disposable test data cleaned up). This is a
  point-in-time observation, not a guarantee of future emptiness.

## Live security smoke (post–Migration 008 window)

| Field | Value |
|-------|--------|
| GitHub Actions run | [40930151059](https://github.com/iliyaaliaghajan-lab/rahyar-real-estate-os/actions/runs/40930151059) |
| Branch / commit tested | `feat/etehad-secure-invitations-and-rls` @ `720b8c7f5f6f5c4dee20088b725846716cbed090` |
| Result | `pass=12` `fail=0` `skip=0` |
| Cleanup | `CLEANUP OK` (run id `d0e9ef434e1e`) |
| Started (UTC) | 2026-10-29T18:22:13Z |

This smoke exercises create-org / invitation / accept / direct-table denial /
cross-tenant isolation against the pinned Staging project. It is not a
substitute for catalog-level re-verification of every grant.

## Advisor findings (documented at review)

**Security Advisor (remaining):**

- Three warnings for operational `SECURITY DEFINER` RPCs callable by
  `authenticated` (create organization, create invitation, accept invitation).
  These are intentional with in-function authorization checks; warnings alone
  are not treated as confirmed exploitable vulnerabilities.
- One INFO for `organization_invitations` without a direct permissive RLS
  policy (access is intentionally RPC-oriented after privilege revoke).

**Performance Advisor:**

- One INFO for unused index `idx_org_invitations_status_expires`.

## Scope of this repository PR

- **Does:** commit the exact Migration 008 SQL blob and this status document.
- **Does not:** run SQL on Staging or Production; merge PR #1; change `main`;
  alter Dashboard settings; invent business tables; claim the app is wired to
  Supabase for persistence.

## Dependencies

Migrations `001`–`007` (and related security work) live primarily on the
feature/security audit line tracked by **PR #1**. This PR depends on those
prerequisites being correctly present on the target base before any merge of
008 into a long-lived branch. Do not treat this PR as merge-ready ahead of
those prerequisites.

## No automatic merge

Neither this PR nor PR #1 should be auto-merged.
