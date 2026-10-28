# Staging RLS test plan

**Status:** Plan + status board. Local `npm test` is **not** by itself evidence of live RLS.

An opt-in runner exists at `scripts/staging-security-smoke.mjs` (`npm run test:staging-security`). It is **not** part of ordinary CI jobs. Manual GitHub Actions path: workflow `staging-security-smoke.yml` (`workflow_dispatch` only, Node.js 22, Environment `etehad-staging-security`, branch pin + `confirm_staging_run=true`). Requires `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY`, and `STAGING_SECURITY_TEST_CONFIRM=dezonafotwyvvghbccko`, and refuses every origin except `https://dezonafotwyvvghbccko.supabase.co`. See `docs/STAGING_AUTOMATED_SECURITY_TESTS.md`.

## Environment

| Item | Value |
|------|--------|
| Staging project name | `etehad-staging` |
| Staging project ID | `dezonafotwyvvghbccko` |
| Production project | `rahyar` (`gguvmewknanhzukugvpj`) — **do not use for these tests** |
| Migrations 001–007 on staging | **Recorded in Staging migration history** |
| Migration 006 / 007 order | **006 applied after 007**; history was **not** rewritten |
| Auth users / orgs for automated path | Runner creates disposable users via Auth Admin APIs |

## Execution log (evidence-based)

| Category | Result |
|----------|--------|
| Schema / grants (catalog, operator-reported) | After 007: invitation table SELECT revoked for authenticated/anon/PUBLIC; RLS on; no policies; create RPC EXECUTE for authenticated only. After 006 (applied later): invitation FK indexes and active-membership guard on `create_organization_with_owner` reported present. |
| Automated Staging security smoke (L1/L2/L3/L4/L5a/L5b/L6/S5/S6) | **Passed** — Actions run [40428548889](https://github.com/iliyaaliaghajan-lab/rahyar-real-estate-os/actions/runs/40428548889) on HEAD `e4bb442baffdde8db47bbdded8d5855aab1838f6`; runner id `89594cd043ef`; `pass=12` `fail=0` `skip=0`; **CLEANUP OK**. Follow-up operator query reported zero leftover disposable orgs/users/invites for that run id. |
| Full S1–S10 matrix beyond smoke coverage | Partial: smoke covers create-two-orgs, isolation read (L6), denied direct insert/update (S5/S6). Other S-rows without smoke mapping remain **not run** as a separate suite. |
| Invitation I-rows mapped to smoke | See mapping below. Unmapped rows stay **Not run**. |
| Concurrent accept / dual org race | **Not run** |
| Browser login → callback → accept | **Not run** |
| Invitation expiry (I7) | **Not run** |

## Smoke ↔ plan mapping (verified on run 40428548889)

| Smoke ID | Related plan IDs | Result |
|----------|------------------|--------|
| L1-owner, L1-agent | I11 | PASS |
| L2-C, L2-B | I1 | PASS |
| L3 | I2 | PASS |
| L4-C, L4-B | I4 | PASS |
| L5a | I6 | PASS |
| L5b | I5 | PASS |
| L6 | S3 / S4 (org + members visibility for disposable orgs) | PASS |
| S5 | S5 | PASS |
| S6 | S6 | PASS |

## Prerequisites

1. Isolated project `etehad-staging` only.  
2. Migrations **001–007** present in Staging history (note: Staging applied **006 after 007**). On a **new** environment prefer file order: 005 → 006 → 007.  
3. `extensions.digest` / pgcrypto available.  
4. **Automated path:** export the four Staging-only env vars and run `npm run test:staging-security`, or dispatch the opt-in workflow with confirmation.  
5. **Manual path (optional):** disposable Auth users via the Authentication Dashboard; staging anon key only in the browser.

## Core tenant scenarios

| ID | Actor | Action | Expected | Executed? |
|----|-------|--------|----------|-----------|
| S1 | User A | `rpc create_organization_with_owner('Org A')` | Success; role `owner` | Yes (smoke setup) |
| S2 | User B/D | Same for second org | Separate org | Yes (smoke setup) |
| S3 | User A | `SELECT` organizations / members | Only Org A | Yes (L6) |
| S4 | User A | Must not see Org B | Empty / not present | Yes (L6) |
| S5 | User A | Direct `INSERT` organization | Fail | Yes (S5) |
| S6 | User A | Direct `UPDATE` member role | Fail | Yes (S6) |
| S7 | anon | SELECT / RPC | Fail | **No** |
| S8 | New signup | If 004 applied | `profiles.id` = auth user | **No** |
| S9 | Business tables | Cross-org DML | Denied | **No** (full matrix) |
| S10 | User A | Second `create_organization_with_owner` | Fail | **No** as dedicated case |

## Invitation scenarios

| ID | Action | Expected | Executed? |
|----|--------|----------|-----------|
| I1 | Owner/admin: create invitation agent | Row pending; token once | Yes (L2) |
| I2 | Agent tries create invitation | Fail authorization | Yes (L3) |
| I3 | Create with role owner | Fail | **No** |
| I4 | Matching email accepts | Membership active | Yes (L4) |
| I5 | Reuse same token | Fail already accepted | Yes (L5b) |
| I6 | Accept with different email | Fail email mismatch | Yes (L5a) |
| I7 | Accept after expiry | Fail expired | **No** |
| I8 | Accept when already in another org | Fail | **No** as dedicated case |
| I9 | Accept when membership row already exists | Fail | **No** as dedicated case |
| I10 | Concurrent dual accept | One success; one fail | **No** |
| I11 | Direct `SELECT` on invitations | Permission denied | Yes (L1) |
| I12 | Create invite for same-org existing membership email | Fail | **No** as dedicated case |
| I13 | Create invite for active member of another org | Fail | **No** as dedicated case |
| I14 | Create invite for email not in Auth | Success | **No** as dedicated case |

## Explicit non-claims

- Smoke success proves only the scenarios the runner asserts.
- Catalog privilege checks and Security Advisor findings still need human review; intentional no-policy on invitations is by design after 007.
- Do not treat Production as tested.

## Migration 008 isolated verification (CI only)

Migration 008 is verified on branch `verify/migration-008-isolated-postgres` using disposable Postgres containers only.

- Baseline 21-cell run: [40606719695](https://github.com/iliyaaliaghajan-lab/rahyar-real-estate-os/actions/runs/40606719695) on `edc80ff` (passed).
- Expanded matrix adds `neg_function_owner_preflight_c` (24 cells) plus a Node 22 static-contract job; the **latest expanded workflow run** is the authority for the current branch result.
- Isolated CI does **not** connect to Staging/Production and does **not** apply migration 008 live.
- Read-only inventory: `docs/MIGRATION_008_READ_ONLY_PREFLIGHT.sql` (not executed live by the isolated workflow).
- Dashboard check required before any live apply: schema `private` must not appear under Project Settings → API → Exposed schemas.
- Full narrative: `docs/MIGRATION_008_VERIFICATION.md`.

