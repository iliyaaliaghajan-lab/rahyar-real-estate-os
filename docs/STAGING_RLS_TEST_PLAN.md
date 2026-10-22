# Staging RLS test plan (not executed in CI / local unit tests)

**Status:** Documentation only. These checks require an isolated Supabase staging project, two real users, and two organizations.  
**Do not** treat green `npm test` as evidence that these passed.

## Prerequisites

1. Isolated project (e.g. `etehad-staging`) — not production.  
2. Migrations **001 → 002 → 003 → 005** applied (004 optional for profile trigger).  
3. `extensions.digest` available (Supabase pgcrypto).  
4. Auth email working for two test accounts.  
5. Optional: SQL as `authenticated` JWT and as `anon`.

## Core tenant scenarios

| ID | Actor | Action | Expected |
|----|-------|--------|----------|
| S1 | User A | `rpc create_organization_with_owner('Org A')` | Success; role `owner` |
| S2 | User B | Same for `'Org B'` | Separate org |
| S3 | User A | `SELECT` organizations / members | Only Org A |
| S4 | User A | `SELECT` Org B | Empty / denied |
| S5 | User A | Direct `INSERT` org/members | Fail |
| S6 | User A | `UPDATE` member role | Fail |
| S7 | anon | SELECT / RPC | Fail |
| S8 | New signup | If 004 applied | `profiles.id` = auth user |
| S9 | Business tables if exist | Cross-org DML | Denied |

## Invitation scenarios

| ID | Action | Expected |
|----|--------|----------|
| I1 | Owner/admin A: `create_organization_invitation` for B email, role agent | Row pending; token returned once |
| I2 | Agent tries create invitation | Fail `Not authorized` |
| I3 | Create with role owner | Fail invalid role / check |
| I4 | B accepts with matching email | Membership active; invite accepted |
| I5 | Reuse same token | Fail already accepted |
| I6 | Accept with different logged-in email | Fail email mismatch |
| I7 | Accept after expiry | Fail expired |
| I8 | B already in another org | Fail another organization |

## Explicit non-claims

Until the tables above are run and recorded on staging, **RLS and invitations are not verified live**.  
This file is a plan, not a test report.
