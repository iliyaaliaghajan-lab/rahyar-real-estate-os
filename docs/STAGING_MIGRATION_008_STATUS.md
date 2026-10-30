# Staging Migration 008 — recorded status

This document records the **repository registration** of Migration 008 and the
**observed** Staging state at the time of verification. It does **not** apply
any SQL. Presence of the migration file in git must not be read as “apply now”.

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
| Canonical filename in this integrated branch | `supabase/migrations/20261029181022_rls_helper_schema_and_profile_policy_optimization.sql` |
| SQL blob SHA (source of truth) | `43621e6b75d83f08ce65db168116b39188dfc23b` |
| Source branch for SQL | `verify/migration-008-isolated-postgres-recovered` |
| Version recorded in Staging `supabase_migrations.schema_migrations` | `20261029181022` |

### Filename history

Earlier Draft work registered the same SQL under the sequential name
`008_rls_helper_schema_and_profile_policy_optimization.sql`. That sequential
filename was historical only. This integrated candidate uses the **Staging
timestamp version** as the executable filename so Git layout matches the
observed remote version string. The SQL **blob identity is unchanged**
(`43621e6b75d83f08ce65db168116b39188dfc23b`).

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

## Documented Staging state (post-apply)

The following items were reported from live Staging review and security smoke.
Items that this automation could not re-query via SQL are marked appropriately
in the mission report; the owner dashboard checks of 2026-10-29 are cited as
the source for exposure settings.

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

## Advisor / residual notes (not “all clear”)

Security Advisor and related findings that remain relevant after Migration 008
must still be reviewed by humans. Documented items included warnings about
`SECURITY DEFINER` callability and intentional no-policy table states. Do not
treat a green smoke run as universal resolution of Advisor findings.

## Production

**Production migration history is unverified.** This document does not authorize
any Production change, `db push`, or `migration repair`.

## Explicit non-goals

- No SQL execution by registering this file in Git
- No claim that Git inclusion means the migration should be applied again
- No automatic migration deployment
- Distinction preserved among: observed Staging history rows, live schema
  objects, and Git source files
