# Staging automated security tests

Opt-in runner: `scripts/staging-security-smoke.mjs`.

It is **not** part of `npm test` or GitHub Actions. A normal push or pull request must not call it. The script mutates Staging: it creates disposable Auth users and organizations, then deletes only those objects.

## What it checks

Using disposable users (owner A, owner D, agent C, invitee B) and two organizations created through `create_organization_with_owner`:

| ID | Check |
|----|--------|
| L1-owner / L1-agent | Direct `SELECT` on `organization_invitations` is an explicit permission denial. An empty result is a failure. |
| S5 | Owner A cannot directly insert an organization. |
| L2-C / L2-B | Owner A can create an `agent` invitation. |
| L5a | A different authenticated email cannot accept C's invitation. |
| L4-C / L4-B | The matching user accepts once and has an active membership in organization A. |
| L3 | Agent C is rejected with an authorization error, not a session error. |
| L5b | Reusing B's accepted token is rejected as already accepted. |
| L6 | Owner A's successful reads of `organizations` and `organization_members` include organization A and never organization B. |
| S6 | Owner A cannot directly update agent C's role. |

Expiry, concurrency, migration 006, business tables, and browser UI flows are out of scope.

## Required environment

All four must be set. The process exits before any network call if one is missing or wrong.

| Variable | Required value |
|----------|----------------|
| `STAGING_SUPABASE_URL` | Exactly the origin `https://dezonafotwyvvghbccko.supabase.co` |
| `STAGING_SUPABASE_ANON_KEY` | Staging anon key |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | Staging service-role key |
| `STAGING_SECURITY_TEST_CONFIRM` | Exactly `dezonafotwyvvghbccko` |

There is no override for another project id. The Production ref `gguvmewknanhzukugvpj` is refused.

The service-role key is used only to create disposable Auth users, mint one-time magic links that are not emailed, and delete this run's users and uniquely named organizations. Assertions use a separate client created with the **anon** key and `verifyOtp` for that user.

Never put the service-role key in a browser bundle or in any `NEXT_PUBLIC_*` variable.

## How to run

In a trusted Codespace or shell, export the four variables from a secret store (not from chat, not from a committed file). Then:

```bash
npm run test:staging-security
```

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

Live scenarios stay **not executed** until this command is run against Staging and the summary shows passes. A green `npm test` only proves this file's static contract.
