# Staging automated security tests

Opt-in runner: `scripts/staging-security-smoke.mjs`.

It is **not** part of `npm test` or the ordinary CI workflow. A normal push or pull request must not call the live suite. Optional GitHub Actions entry point: `.github/workflows/staging-security-smoke.yml` — **workflow_dispatch only**, Node.js **22**, Environment `etehad-staging-security`, branch pin to `feat/etehad-secure-invitations-and-rls`, and input `confirm_staging_run` (default **false**).

The script mutates Staging: it creates disposable Auth users via Auth Admin APIs and organizations, then deletes only those objects. **It does not require pre-created Auth users.** Manual Dashboard users remain an option only for hand-run tests outside this runner.

## Latest verified live run

| Field | Value |
|-------|--------|
| GitHub Actions run | [40428548889](https://github.com/iliyaaliaghajan-lab/rahyar-real-estate-os/actions/runs/40428548889) |
| HEAD tested | `e4bb442baffdde8db47bbdded8d5855aab1838f6` |
| Event | `workflow_dispatch` with confirmation |
| Runtime | Node.js 22.23.3 |
| Target | pinned Staging `dezonafotwyvvghbccko` |
| Runner run id | `89594cd043ef` |
| Result | **success** — `pass=12` `fail=0` `skip=0` |
| Cleanup | **CLEANUP OK** for that run id; follow-up operator query reported no leftover disposable orgs/users/invites for the same id |

A green CI run on a **later** documentation-only commit does **not** re-prove this live result.

## What it checks

Using disposable users (owner A, owner D, agent C, invitee B) and two organizations created through `create_organization_with_owner`:

| ID | Check | Latest live |
|----|--------|-------------|
| L1-owner / L1-agent | Direct `SELECT` on `organization_invitations` is an explicit permission denial. An empty result is a failure. | PASS |
| S5 | Owner A cannot directly insert an organization. | PASS |
| L2-C / L2-B | Owner A can create an `agent` invitation. | PASS |
| L5a | A different authenticated email cannot accept C's invitation. | PASS |
| L4-C / L4-B | The matching user accepts once and has an active membership in organization A. | PASS |
| L3 | Agent C is rejected with an authorization error, not a session error. | PASS |
| L5b | Reusing B's accepted token is rejected as already accepted. | PASS |
| L6 | Owner A's successful reads of `organizations` and `organization_members` include organization A and never organization B. | PASS |
| S6 | Owner A cannot directly update agent C's role. | PASS |

**Out of scope for this runner (still not claimed):** invitation expiry, concurrency races, full browser UI flow, exhaustive business-table tenant matrix, and Security Advisor disposition for every `SECURITY DEFINER` function.

## Required environment

All four must be set. The process exits before any network call if one is missing or wrong.

| Variable | Required value |
|----------|----------------|
| `STAGING_SUPABASE_URL` | Exactly the origin `https://dezonafotwyvvghbccko.supabase.co` |
| `STAGING_SUPABASE_ANON_KEY` | Staging **anon** key (must not be the service-role JWT) |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | Staging **service-role** key (must differ from the anon key) |
| `STAGING_SECURITY_TEST_CONFIRM` | Exactly `dezonafotwyvvghbccko` |

There is no override for another project id. The Production ref `gguvmewknanhzukugvpj` is refused.

The service-role key is used only to create disposable Auth users, mint one-time magic links that are not emailed, and delete this run's users and uniquely named organizations. Assertions use a separate client created with the **anon** key and `verifyOtp` for that user. If the two keys are identical, or if the anon slot carries a `service_role` JWT claim, the runner refuses before any network call. Cleanup tries each org and each Auth user independently so one failure does not skip the rest.

Never put the service-role key in a browser bundle or in any `NEXT_PUBLIC_*` variable.

## How to run

**Local / Codespace:** export the four variables from a secret store (not from chat, not from a committed file), then:

```bash
npm run test:staging-security
```

**GitHub Actions:** Actions → “Staging security smoke” → Run workflow on branch `feat/etehad-secure-invitations-and-rls` with `confirm_staging_run` set to **true**. Do not re-run without a specific need.

## How to read the output

| Line | Meaning |
|------|---------|
| `PASS <id>` | That scenario met its assertion. |
| `FAIL <id>` | That scenario ran and did not meet its assertion. Exit code is non-zero. |
| `SKIP <id>` | A prerequisite failed, so the scenario was not treated as a pass. |
| `SETUP FAIL` | Users, sessions, or organizations could not be prepared. Later scenarios are skipped. Exit code is non-zero. |
| `CLEANUP OK` | Only this run's organizations and Auth users were removed. |
| `CLEANUP FAIL run <id>` | Cleanup did not finish. Exit code is non-zero. Remove only objects whose names or metadata contain that run id. Do not broad-delete. |

The runner does not print emails, keys, session tokens, magic-link hashes, or invitation tokens.

A green `npm test` only proves the static contract tests for the runner script, not live Staging behavior.
