# Security audit — multi-tenant migrations (اتحاد)

**Working branch (this revision):** `fix/staging-security-audit-v2`  
**Base:** `audit/staging-security-completion` @ `1b7cd1f6fb559b6334741263d8516a8a19f566c7`  
**Scope:** Migrations 001–003, executable 004 (profile trigger only), static contracts, docs.  
**Not** production readiness or proven RLS.

---

## 1. Static review and local tests (done in-repo)

| Area | Evidence |
|------|----------|
| 001 table grants | REVOKE ALL from public/anon/authenticated; minimal GRANT; business tables conditional |
| 003 RPC | Single arg `p_name`; `auth.uid()`; fixed owner/active; DEFINER; EXECUTE grants |
| 004 | Profile trigger only; no executable `ALTER DEFAULT PRIVILEGES` |
| App paths | login/callback do not insert `profiles`; onboarding RPC only `p_name` |
| Unit tests | `tests/tenant-isolation.test.ts` reads real SQL/TS sources |
| Commands | `npm test`, `npm run typecheck`, `npm run lint` (see commit report) |

**Passing unit tests does not prove database security.**

---

## 2. Hypotheses / needs live staging (not proven here)

| Item | Why live data is required |
|------|---------------------------|
| `pg_default_acl` + object owners | Default privileges are per **creator role**; roles differ by project |
| Effective table/function ACLs after 001–003 | Catalog may differ from migration text if manual changes exist |
| Owner of `SECURITY DEFINER` functions | Must be able to INSERT org/members/profiles |
| Trigger on `auth.users` allowed | Supabase may restrict who can create triggers on `auth` |
| RPC success after REVOKE INSERT on tables | DEFINER path must work in practice |
| IndexedDB business data | App still local; RLS does not cover it |

**Default privileges:** see `docs/DEFAULT_PRIVILEGES_GUIDE.md`. No in-repo migration applies them automatically — final SQL needs live `FOR ROLE` list.

---

## 3. Database tests not executed

All scenarios in `docs/STAGING_RLS_TEST_PLAN.md` (S1–S9): two users, two orgs, cross-tenant deny, anon deny, optional profile after signup. **Status: not run.**

Integration tests against Supabase **cannot** run in this environment without project credentials and an explicit decision to touch staging. None were run.

---

## 4. Suggested staging evaluation steps (do not run from this audit)

1. Use only isolated staging project.  
2. Apply 001 → 002 → 003 in order (optional 004 after review).  
3. Inspect grants and `pg_default_acl` (guide queries).  
4. Execute S1–S7 from the RLS plan; record pass/fail.  
5. If 004 applied, run S8.  
6. Only then decide on default-privilege `ALTER`s using discovered roles.  
7. Do not merge to `main` or deploy production based solely on unit tests.

---

## Findings (severity)

| ID | Severity | Summary |
|----|----------|---------|
| H1 | High | Business data still IndexedDB — no server tenant isolation for listings/clients |
| H2 | High | Future-object default privileges unknown until live `pg_default_acl` |
| H3 | Medium→mitigated in SQL text | Profile bootstrap via 004 trigger design; **apply + verify live** |
| M1 | Medium | DEFINER function owner / INSERT rights need live proof |
| M2 | Medium | Partial migration apply in SQL Editor still possible |
| M3 | Medium | Business RLS inactive until those tables exist |

---

## Migration order

1. `001_initial_multitenant.sql`  
2. `002_business_tables_rls.sql`  
3. `003_secure_org_policies.sql`  
4. `004_default_privs_and_profile.sql` — **profile trigger only** (optional)  
5. Default privileges — **manual after guide**, not part of auto 004  

---

## Explicit non-claims

- No claim that RLS is verified.  
- No approval to merge `main` or ship production.  
- No Supabase/Netlify changes were made by this audit branch work.  
