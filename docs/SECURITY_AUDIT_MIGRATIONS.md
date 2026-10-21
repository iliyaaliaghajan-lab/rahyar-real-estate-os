# Security audit — multi-tenant migrations (اتحاد)

**Branch:** `audit/staging-security-completion` (from `fix/staging-migration-security`)  
**Base security work:** `fix/staging-migration-security` @ `8c25109`  
**Scope:** SQL migrations 001–003 (+ optional 004 design). **Not** a production readiness claim.

## Severity legend

| Level | Meaning |
|-------|---------|
| Critical | Cross-tenant data exposure or auth bypass if deployed as-is for real multi-org use |
| High | Meaningful gap before relying on DB isolation |
| Medium | Hardening / re-run / future objects |
| Low | Documentation or cleanup |

## Findings

### H1 — App business data still in IndexedDB
- **Where:** Application repositories (Dexie), not migrations.
- **Why:** RLS cannot protect browser-local data.
- **Impact:** Two devices/users do not get server-side tenant isolation for listings/clients yet.
- **Fix:** Later phase — Supabase repositories + migration of data. Out of scope for SQL-only audit.

### H2 — Default privileges for *future* objects
- **Where:** Not fully controlled in 001–003; design in `004_default_privs_and_profile.sql`.
- **Why:** Staging previously showed broad default grants for creator roles (`postgres` / `supabase_admin`).
- **Impact:** New tables could inherit wide `authenticated`/`anon` rights until explicit REVOKE/GRANT.
- **Fix:** After live read of `pg_default_acl`, apply `ALTER DEFAULT PRIVILEGES FOR ROLE <creator> … REVOKE ALL … FROM anon, authenticated, PUBLIC` then grant per table. **Do not apply blindly.**

### H3 — Profile row not created by app signup path
- **Where:** `src/app/login/page.tsx` (OTP only); `src/app/auth/callback/route.ts` (session exchange only); no `profiles` insert.
- **Why:** 001 grants SELECT/UPDATE on profiles, no INSERT policy; no trigger in 001–003.
- **Impact:** Team UI may lack `full_name`; not an org-isolation bypass by itself.
- **Fix:** Optional 004 trigger `handle_new_user` inserts only `NEW.id` from `auth.users`.

### M1 — `create_organization_with_owner` owner and table INSERT rights
- **Where:** `003_secure_org_policies.sql`.
- **Why:** Function is `SECURITY DEFINER` with fixed `auth.uid()` and role `owner`; client cannot pass `user_id`/`role`.
- **Impact:** Works only if function owner can INSERT into `organizations` / `organization_members` despite revoked client INSERT.
- **Fix:** Live check function owner + successful RPC on staging.

### M2 — Re-run / partial failure of 001
- **Where:** 001 types (exception-safe), policies (DROP IF EXISTS), grants (re-applicable).
- **Why:** SQL Editor may not wrap the whole file in one transaction.
- **Impact:** Partial apply possible; re-run largely safe for hardened 001 but not a substitute for transactional apply.

### M3 — Business tables absent on empty staging
- **Where:** 001/002 conditional blocks.
- **Why:** By design — no CREATE for properties/clients/…
- **Impact:** Tenant isolation policies for business data are inactive until those tables exist + 002 policies applied.

### L1 — Dual helpers `user_organization_ids` / `user_active_organization_ids`
- **Where:** 001 and 003.
- **Why:** Same filter; both hardened with empty `search_path` and EXECUTE grants.
- **Impact:** Low; optional later consolidation.

## Migration order

1. `001_initial_multitenant.sql` — core tables, grants, helper, RLS  
2. `002_business_tables_rls.sql` — business policies if tables exist  
3. `003_secure_org_policies.sql` — RPC + membership SELECT  
4. `004_default_privs_and_profile.sql` — optional; only after live privilege review  

## Effective permissions model (design intent after 001–003)

| Object | anon | authenticated | service_role |
|--------|------|---------------|--------------|
| organizations | none | SELECT only | bypass (admin) |
| organization_members | none | SELECT only | bypass |
| profiles | none | SELECT, UPDATE (own row via RLS) | bypass |
| business tables (if any) | none | SELECT/INSERT/UPDATE/DELETE under RLS | bypass |
| create_organization_with_owner | no EXECUTE | EXECUTE | — |
| user_*_organization_ids | no EXECUTE | EXECUTE | — |

TRUNCATE/REFERENCES/TRIGGER: cleared via REVOKE ALL before minimal GRANT on tables touched by 001.

## Live staging tests (read-only design — not executed here)

1. Two users A/B; each `rpc create_organization_with_owner`  
2. A cannot SELECT B’s org/members  
3. A cannot INSERT/UPDATE/DELETE org/members directly  
4. A cannot change role via API  
5. anon cannot SELECT org tables or EXECUTE RPC  
6. After signup (if 004 applied): profiles row exists with `id = auth.users.id`  
7. `\dp` / `pg_default_acl` match intent  

## Explicit non-claims

- Passing `npm test` / typecheck / lint does **not** prove RLS.  
- This document does **not** approve merge to `main` or production deploy.  
