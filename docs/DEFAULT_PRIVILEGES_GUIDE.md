# Default privileges guide (staging only — do not apply blindly)

This document is **guidance**, not an auto-run migration.  
`004_default_privs_and_profile.sql` does **not** change default privileges.

## What `ALTER DEFAULT PRIVILEGES` does and does not do

| Does | Does not |
|------|----------|
| Affect **future** objects created by the role named in `FOR ROLE` | Change privileges on **existing** tables/functions |
| Can be scoped `IN SCHEMA public` or database-wide | Apply to objects created by a **different** role |
| Complements explicit `GRANT`/`REVOKE` after `CREATE` | Replace RLS |

If tables are created by `postgres` but you only set defaults `FOR ROLE supabase_admin`, those defaults never apply to `postgres`-created objects.

## Live discovery (required before any ALTER)

Run **only on isolated staging**, read-only first:

```sql
-- Who has default ACLs, on which object types?
SELECT
  defaclrole::regrole AS grantor_role,
  defaclnamespace::regnamespace AS schema,
  defaclobjtype AS obj_type,  -- r=table, S=sequence, f=function, etc.
  defaclacl AS acl
FROM pg_default_acl
ORDER BY 1, 2, 3;

-- Who owns existing public tables?
SELECT relname, relowner::regrole
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY 1;
```

Until these results are known for **your** project, no final `FOR ROLE` list is trustworthy.

## Pattern after discovery (examples — fill roles from live output)

Assume discovery shows creator role `R` (often `postgres` and/or `supabase_admin` on Supabase). For **each** such creator:

### TABLES (future)

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE R IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE R IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE R IN SCHEMA public
  REVOKE ALL ON TABLES FROM authenticated;
```

After creating a business table, grant **only** what the app needs under RLS, e.g.:

```sql
REVOKE ALL ON TABLE public.<name> FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.<name> TO authenticated;
-- Do not grant TRUNCATE / REFERENCES / TRIGGER to client roles unless required.
ALTER TABLE public.<name> ENABLE ROW LEVEL SECURITY;
-- + tenant isolation policies
```

### SEQUENCES (future)

Core org tables in this project use `gen_random_uuid()` (no serial sequences).  
If you later add `serial`/`identity` columns:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE R IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
-- Then per sequence, e.g. GRANT USAGE, SELECT ON SEQUENCE ... TO authenticated;
```

### FUNCTIONS (future)

Default EXECUTE on new functions for `PUBLIC` is a common PostgreSQL risk.

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE R IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE R IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE R IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM authenticated;
```

Then **explicitly** grant EXECUTE only where intended:

| Function | anon | authenticated |
|----------|------|-----------------|
| `create_organization_with_owner` | no | yes |
| `user_organization_ids` / `user_active_organization_ids` | no | yes |
| `handle_new_user` (trigger only) | no | no |

`service_role` is for server/admin paths; do not put it in client bundles. Do not revoke platform-required grants without understanding Supabase internals.

## Existing objects

Default-privilege changes **never** fix current tables. Existing grants remain those set in migrations 001–003 (and any manual changes). Re-check with `\dp` / `information_schema.role_table_grants` after apply.

## Blocker without live data

**Cannot finalize executable default-privilege SQL in-repo** without current `pg_default_acl` and owner roles on the target staging project. Shipping guessed `FOR ROLE postgres` (or only that) can create a false sense of safety if objects are created by another role.
