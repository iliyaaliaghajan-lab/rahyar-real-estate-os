# Staging RLS test plan

**Status:** Plan + status board. Local `npm test` is **not** evidence these passed.

An opt-in runner exists at `scripts/staging-security-smoke.mjs` (`npm run test:staging-security`). It is **not** part of CI. It requires `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY`, and `STAGING_SECURITY_TEST_CONFIRM=dezonafotwyvvghbccko`, and it refuses every origin except `https://dezonafotwyvvghbccko.supabase.co`. See `docs/STAGING_AUTOMATED_SECURITY_TESTS.md`. **No live scenario below has been executed by that runner.**

## Environment

| Item | Value |
|------|--------|
| Staging project name | `etehad-staging` |
| Staging project ID | `dezonafotwyvvghbccko` |
| Production project | `rahyar` (`gguvmewknanhzukugvpj`) — **do not use for these tests** |
| Migrations 001–005 on staging | **Applied** (operator-reported migration history) |
| Migration 006 on staging | **Not applied** (authored only) |
| Migration 007 on staging | **Applied** (operator-authorized; recorded in staging migration history). Catalog-only follow-up (operator): no SELECT for `authenticated` / `anon` / `PUBLIC` on `public.organization_invitations`; RLS enabled; no remaining policies; `authenticated` can EXECUTE `create_organization_invitation`; `anon` / `PUBLIC` cannot. This is **not** authenticated E2E proof. |
| Auth users / orgs for E2E | Required; create via **Authentication UI only** (never raw `auth.users` SQL) |

## Execution log (fill only after real runs)

| Category | Result |
|----------|--------|
| Schema / grants smoke (catalog) | Operator-reported after 007: invitation table SELECT revoked for authenticated/anon/PUBLIC; RLS on; no policies; create RPC EXECUTE for authenticated only. **Not re-queried by an automated agent session.** |
| Authenticated tenant isolation (S1–S9) | **Not run** |
| Invitations (I1–I14 / L1–L6) | **Not run** — no Staging Auth session, Dashboard login, or disposable test users available to the execution environment |
| Concurrent accept / dual org | **Not run** |
| Browser login → callback → accept | **Not run** |

## Prerequisites

1. Isolated project `etehad-staging` only.  
2. Migrations **001 → 002 → 003 → 004 (optional) → 005 → 007** applied. **006** is optional and **not** applied.  
3. `extensions.digest` / pgcrypto available.  
4. Two (or more) disposable Auth users with known emails, confirmed in Dashboard.  
5. App or SQL client using **staging** URL + anon key only (no service role in browser).

## Core tenant scenarios

| ID | Actor | Action | Expected | Executed? |
|----|-------|--------|----------|-----------|
| S1 | User A | `rpc create_organization_with_owner('Org A')` | Success; role `owner` | No |
| S2 | User B | Same for `'Org B'` | Separate org | No |
| S3 | User A | `SELECT` organizations / members | Only Org A | No |
| S4 | User A | `SELECT` Org B | Empty / denied | No |
| S5 | User A | Direct `INSERT` org/members | Fail | No |
| S6 | User A | `UPDATE` member role | Fail | No |
| S7 | anon | SELECT / RPC | Fail | No |
| S8 | New signup | If 004 applied | `profiles.id` = auth user | No |
| S9 | Business tables if exist | Cross-org DML | Denied | No |
| S10 | User A | Second `create_organization_with_owner` | Fail (active membership / unique index) | No |

## Invitation scenarios

| ID | Action | Expected | Executed? |
|----|--------|----------|-----------|
| I1 | Owner/admin A: `create_organization_invitation` for B email, role agent | Row pending; token once | No |
| I2 | Agent tries create invitation | Fail `Not authorized` | No |
| I3 | Create with role owner | Fail | No |
| I4 | B accepts with matching email | Membership active; invite accepted | No |
| I5 | Reuse same token | Fail already accepted | No |
| I6 | Accept with different logged-in email | Fail email mismatch | No |
| I7 | Accept after expiry | Fail expired | No |
| I8 | B already in another org | Fail another organization | No |
| I9 | Accept when membership row already exists | Fail `Membership already exists` | No |
| I10 | Concurrent dual accept same token | One success; one fail; one membership | No |
| I11 | Authenticated agent (or any member) direct `SELECT` on `organization_invitations` | Empty / permission denied after 007 (no direct SELECT) | No |
| I12 | Create invite for email that already has **any** membership row in same org | Fail (membership already exists for this email) | No |
| I13 | Create invite for email with **active** membership in another org | Fail (already belongs to another organization) | No |
| I14 | Create invite for email not yet in Auth | Success (future signup path) | No |

## Explicit non-claims

Until authenticated rows above are executed and recorded, **RLS and invitations are not live-verified**.  
Schema applied ≠ security proven. Catalog privilege checks ≠ a successful authenticated query.
