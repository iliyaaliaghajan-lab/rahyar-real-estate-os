-- ============================================================
-- MIGRATION_008_READ_ONLY_PREFLIGHT.sql
-- Diagnostic inventory only. Does NOT apply migration 008.
-- Does NOT alter any database. Safe for manual operator use.
--
-- Usage (manual, against a disposable or explicitly authorized DB only):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/MIGRATION_008_READ_ONLY_PREFLIGHT.sql
--
-- This task has NOT executed this file against any live Supabase project.
-- ============================================================

BEGIN TRANSACTION READ ONLY;

-- 1. Database identity and PostgreSQL version
SELECT current_database() AS database_name,
       current_user AS current_user_name,
       session_user AS session_user_name,
       version() AS pg_version,
       current_setting('server_version_num') AS server_version_num;

-- 2 / 3. Existence, ownership, RLS flags for core and business tables
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       r.rolname AS owner,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_roles AS r ON r.oid = c.relowner
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'organizations',
    'profiles',
    'organization_members',
    'organization_invitations',
    'properties',
    'clients',
    'needs',
    'follow_ups',
    'activities'
  )
ORDER BY c.relname;

-- 4. organization_id presence on business tables
SELECT t.table_name,
       EXISTS (
         SELECT 1
         FROM information_schema.columns AS c
         WHERE c.table_schema = 'public'
           AND c.table_name = t.table_name
           AND c.column_name = 'organization_id'
       ) AS has_organization_id
FROM (
  VALUES
    ('properties'),
    ('clients'),
    ('needs'),
    ('follow_ups'),
    ('activities')
) AS t(table_name)
ORDER BY t.table_name;

-- 5. Effective table privileges for API roles (and PUBLIC)
SELECT t.table_name,
       r.rolname AS grantee,
       has_table_privilege(r.rolname, 'public.' || t.table_name, 'SELECT') AS can_select,
       has_table_privilege(r.rolname, 'public.' || t.table_name, 'INSERT') AS can_insert,
       has_table_privilege(r.rolname, 'public.' || t.table_name, 'UPDATE') AS can_update,
       has_table_privilege(r.rolname, 'public.' || t.table_name, 'DELETE') AS can_delete,
       has_table_privilege(r.rolname, 'public.' || t.table_name, 'TRUNCATE') AS can_truncate,
       has_table_privilege(r.rolname, 'public.' || t.table_name, 'REFERENCES') AS can_references,
       has_table_privilege(r.rolname, 'public.' || t.table_name, 'TRIGGER') AS can_trigger
FROM (
  VALUES
    ('organizations'),
    ('profiles'),
    ('organization_members'),
    ('organization_invitations'),
    ('properties'),
    ('clients'),
    ('needs'),
    ('follow_ups'),
    ('activities')
) AS t(table_name)
CROSS JOIN (
  SELECT rolname FROM pg_catalog.pg_roles
  WHERE rolname IN ('anon', 'authenticated', 'service_role')
) AS r
WHERE EXISTS (
  SELECT 1 FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = t.table_name AND c.relkind = 'r'
)
ORDER BY t.table_name, r.rolname;

-- Direct ACL inventory including PUBLIC where present
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       a.grantee::regrole::text AS grantee,
       a.privilege_type,
       a.is_grantable
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS a
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'organizations',
    'profiles',
    'organization_members',
    'organization_invitations',
    'properties',
    'clients',
    'needs',
    'follow_ups',
    'activities'
  )
ORDER BY c.relname, a.grantee::regrole::text, a.privilege_type;

-- 6. All policies on relevant public tables (no name filter)
SELECT schemaname,
       tablename,
       policyname,
       permissive,
       roles,
       cmd,
       qual,
       with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'organizations',
    'profiles',
    'organization_members',
    'organization_invitations',
    'properties',
    'clients',
    'needs',
    'follow_ups',
    'activities'
  )
ORDER BY tablename, policyname;

-- 7. Schema private: ownership, USAGE/CREATE, membership paths for API roles
SELECT EXISTS (
  SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'private'
) AS private_schema_exists;

SELECT n.nspname,
       r.rolname AS owner
FROM pg_catalog.pg_namespace AS n
JOIN pg_catalog.pg_roles AS r ON r.oid = n.nspowner
WHERE n.nspname = 'private';

SELECT rolname,
       has_schema_privilege(rolname, 'private', 'USAGE') AS has_usage,
       has_schema_privilege(rolname, 'private', 'CREATE') AS has_create
FROM pg_catalog.pg_roles
WHERE rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY rolname;

-- Direct role membership edges involving schema private owner (when schema exists)
SELECT m.roleid::regrole::text AS granted_role,
       m.member::regrole::text AS member_role,
       m.grantor::regrole::text AS grantor,
       m.admin_option
FROM pg_catalog.pg_auth_members AS m
WHERE EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'private')
  AND (
    m.roleid = (SELECT nspowner FROM pg_catalog.pg_namespace WHERE nspname = 'private')
    OR m.member IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('anon', 'authenticated'))
  )
ORDER BY 1, 2;

-- 8. Helper functions: private and residual public helpers
SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       r.rolname AS owner,
       p.prosecdef AS is_security_definer,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args,
       COALESCE(p.proconfig::text, '{}') AS function_settings,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
JOIN pg_catalog.pg_roles AS r ON r.oid = p.proowner
WHERE (n.nspname = 'private' AND p.proname = 'user_organization_ids')
   OR (n.nspname = 'public' AND p.proname IN ('user_organization_ids', 'user_active_organization_ids'))
ORDER BY n.nspname, p.proname;

-- 9. Default ACL inventory by object-creating role (read-only observation)
SELECT r.rolname AS role_name,
       d.defaclobjtype AS object_type,
       a.grantee::regrole::text AS grantee,
       a.privilege_type,
       a.is_grantable
FROM pg_catalog.pg_default_acl AS d
JOIN pg_catalog.pg_roles AS r ON r.oid = d.defaclrole
CROSS JOIN LATERAL aclexplode(d.defaclacl) AS a
ORDER BY r.rolname, d.defaclobjtype, a.grantee::regrole::text, a.privilege_type;

-- 10. Migration history (standard Supabase table when present)
SELECT EXISTS (
  SELECT 1
  FROM information_schema.tables
  WHERE table_schema = 'supabase_migrations'
    AND table_name = 'schema_migrations'
) AS supabase_schema_migrations_exists;

SELECT version, name, statements
FROM supabase_migrations.schema_migrations
ORDER BY version
LIMIT 100;

-- Manual Dashboard check (not queryable from SQL alone):
-- Confirm schema "private" is absent from
--   Supabase Project Settings → API → Exposed schemas.
-- Absence of a manual role-level "pgrst.db_schemas" override does NOT prove
-- the Dashboard-managed exposed-schemas list is correct.

ROLLBACK;
