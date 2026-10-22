# Staging RLS test plan (not executed in CI / local unit tests)

**Status:** Documentation only. These checks require an isolated Supabase staging project, two real users, and two organizations.  
**Do not** treat green `npm test` as evidence that these passed.

## Prerequisites

1. Isolated project (e.g. `etehad-staging`) — not production.  
2. Migrations **001 → 002 → 003** applied (004 optional for profile trigger).  
3. Auth email (or equivalent) working for two test accounts.  
4. Optional: SQL client as `authenticated` via JWT and as `anon` without session.

## Scenarios

| ID | Actor | Action | Expected |
|----|-------|--------|----------|
| S1 | User A (authenticated) | `rpc create_organization_with_owner('Org A')` | Success; membership role `owner`, status `active` |
| S2 | User B | Same for `'Org B'` | Success; separate `organization_id` |
| S3 | User A | `SELECT` organizations / members | Only Org A rows |
| S4 | User A | `SELECT` Org B rows | Empty / denied |
| S5 | User A | Direct `INSERT` into `organizations` or `organization_members` | Fail (no privilege and/or no policy) |
| S6 | User A | `UPDATE organization_members SET role = ...` | Fail |
| S7 | anon | `SELECT` org tables / `EXECUTE` RPC | Fail |
| S8 | New signup | After Auth user create | If 004 applied: `profiles.id` = `auth.users.id` |
| S9 | Business tables (if exist) | Cross-org DML | Denied by tenant policy |

## Privilege inspection

```sql
-- Table grants
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('organizations', 'organization_members', 'profiles')
ORDER BY 2, 1, 3;

-- Default ACLs (for DEFAULT_PRIVILEGES_GUIDE)
SELECT defaclrole::regrole, defaclnamespace::regnamespace, defaclobjtype, defaclacl
FROM pg_default_acl;

-- Function owners
SELECT p.proname, r.rolname AS owner
FROM pg_proc p
JOIN pg_roles r ON r.oid = p.proowner
WHERE p.proname IN (
  'create_organization_with_owner',
  'handle_new_user',
  'user_organization_ids',
  'user_active_organization_ids'
);
```

## Explicit non-claims

Until S1–S7 (and S8 if 004 applied) are run and recorded on staging, **RLS is not verified**.  
This file is a plan, not a test report.
