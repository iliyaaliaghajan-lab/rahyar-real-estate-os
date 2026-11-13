# Staging RLS test plan

This document tracks which multi-tenant and invitation RLS scenarios have been
executed against Staging, and which remain unproven.

Smoke success proves only the scenarios the runner asserts.
Catalog privilege checks and Security Advisor findings still need human review;
intentional no-policy on invitations is by design after 007.
Do not treat Production as tested.

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

## Business DELETE role matrix (Migration 011)

Product policy (Option 1):

| Role | SELECT / INSERT / UPDATE business tables | DELETE business tables | DELETE organization |
|------|------------------------------------------|------------------------|---------------------|
| owner | yes (own active org) | yes (own active org) | yes |
| admin | yes (own active org) | yes (own active org) | no |
| agent | yes (own active org) | **no** | no |

Enforcement:

- Database RLS is authoritative (`private.user_can_delete_business_data` + RESTRICTIVE DELETE policies on `properties`, `clients`, `needs`, `follow_ups`).
- `activities` remain append-only for every authenticated role (no DELETE/UPDATE policy; grants stay SELECT+INSERT).
- Application still defaults to the Dexie repository; UI delete-button gating is deferred to the cloud-adapter activation phase.

### Isolated / local proof status

| Environment | Status |
|-------------|--------|
| Isolated Postgres P0 (PG15/16/17) | Intended proof surface for Migration 011 role matrix |
| Staging | **NOT run** — no hosted migration apply; no Staging role-DELETE verification |
| Production | **NOT run** |

Do not interpret isolated green results as Staging or Production authorization proof.
