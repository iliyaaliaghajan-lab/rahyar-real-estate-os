#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

case "$SCENARIO" in
  safe)
    apply_001_to_007 safe
    apply_008 safe
    verify_post_008_positive
    ;;
  create)
    apply_001_to_007 create
    apply_008 create
    verify_post_008_positive
    ;;
  setrole)
    apply_001_to_007 setrole
    apply_008 setrole
    verify_post_008_positive
    ;;

  neg_schema_owner_member)
    apply_001_to_007 safe
    local ver
    ver=$(psql_db -Atc "SHOW server_version_num;" | tr -d '[:space:]')
    if [[ "$ver" -ge 160000 ]]; then
      psql_db -c "
        CREATE ROLE schema_owner_role NOSUPERUSER NOBYPASSRLS NOLOGIN;
        CREATE SCHEMA private AUTHORIZATION schema_owner_role;
        GRANT schema_owner_role TO authenticated WITH INHERIT TRUE;
      "
    else
      psql_db -c "
        CREATE ROLE schema_owner_role NOSUPERUSER NOBYPASSRLS NOLOGIN;
        CREATE SCHEMA private AUTHORIZATION schema_owner_role;
        GRANT schema_owner_role TO authenticated;
      "
    fi
    expect_preflight_fail "inherit the owner role"
    ;;

  neg_function_owner_member)
    apply_001_to_007 safe
    local ver
    ver=$(psql_db -Atc "SHOW server_version_num;" | tr -d '[:space:]')
    if [[ "$ver" -ge 160000 ]]; then
      psql_db -c "
        CREATE ROLE fn_owner_role NOSUPERUSER NOBYPASSRLS NOLOGIN;
        CREATE SCHEMA private AUTHORIZATION fn_owner_role;
        GRANT USAGE ON SCHEMA private TO fn_owner_role;
        CREATE OR REPLACE FUNCTION private.user_organization_ids()
        RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
        AS \$\$ SELECT organization_id FROM public.organization_members
               WHERE user_id = (SELECT auth.uid()) AND status = 'active' \$\$;
        ALTER FUNCTION private.user_organization_ids() OWNER TO fn_owner_role;
        GRANT fn_owner_role TO authenticated WITH INHERIT TRUE;
      "
    else
      psql_db -c "
        CREATE ROLE fn_owner_role NOSUPERUSER NOBYPASSRLS NOLOGIN;
        CREATE SCHEMA private AUTHORIZATION fn_owner_role;
        GRANT USAGE ON SCHEMA private TO fn_owner_role;
        CREATE OR REPLACE FUNCTION private.user_organization_ids()
        RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
        AS \$\$ SELECT organization_id FROM public.organization_members
               WHERE user_id = (SELECT auth.uid()) AND status = 'active' \$\$;
        ALTER FUNCTION private.user_organization_ids() OWNER TO fn_owner_role;
        GRANT fn_owner_role TO authenticated;
      "
    fi
    expect_preflight_fail "function owner"
    ;;

  neg_create_inherit)
    apply_001_to_007 safe
    local ver
    ver=$(psql_db -Atc "SHOW server_version_num;" | tr -d '[:space:]')
    if [[ "$ver" -ge 160000 ]]; then
      psql_db -c "
        CREATE SCHEMA IF NOT EXISTS private;
        CREATE ROLE create_holder NOSUPERUSER NOBYPASSRLS NOLOGIN;
        GRANT CREATE ON SCHEMA private TO create_holder;
        GRANT create_holder TO authenticated WITH INHERIT TRUE;
      "
    else
      psql_db -c "
        CREATE SCHEMA IF NOT EXISTS private;
        CREATE ROLE create_holder NOSUPERUSER NOBYPASSRLS NOLOGIN;
        GRANT CREATE ON SCHEMA private TO create_holder;
        GRANT create_holder TO authenticated;
      "
    fi
    expect_preflight_fail "CREATE on schema private"
    ;;

  neg_create_setrole)
    apply_001_to_007 safe
    local ver
    ver=$(psql_db -Atc "SHOW server_version_num;" | tr -d '[:space:]')
    if [[ "$ver" -ge 160000 ]]; then
      psql_db -c "
        CREATE SCHEMA IF NOT EXISTS private;
        CREATE ROLE create_holder_set NOSUPERUSER NOBYPASSRLS NOLOGIN;
        GRANT CREATE ON SCHEMA private TO create_holder_set;
        GRANT create_holder_set TO authenticated WITH INHERIT FALSE, SET TRUE;
      "
      expect_preflight_fail "SET ROLE"
    else
      psql_db -c "
        CREATE SCHEMA IF NOT EXISTS private;
        CREATE ROLE create_holder_set NOSUPERUSER NOBYPASSRLS NOLOGIN;
        GRANT CREATE ON SCHEMA private TO create_holder_set;
        GRANT create_holder_set TO authenticated;
      "
      expect_preflight_fail "become role"
    fi
    ;;

  *)
    fail "Unknown SCENARIO=$SCENARIO"
    ;;
esac

log "SCENARIO COMPLETE: PASS"
exit 0
