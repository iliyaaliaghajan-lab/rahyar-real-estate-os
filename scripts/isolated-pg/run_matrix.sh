#!/usr/bin/env bash
set -euo pipefail

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
export PGPASSWORD
PG_VERSION="${PG_VERSION:-unknown}"
SCENARIO="${SCENARIO:-safe}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-supabase/migrations}"
STUBS_DIR="${STUBS_DIR:-scripts/isolated-pg}"
ROOT_DB="postgres"
WORK_DB="rahyar_verify_${SCENARIO//[^a-z0-9]/}"

log() { printf '[%s][%s] %s\n' "$PG_VERSION" "$SCENARIO" "$*"; }
pass() { log "PASS: $*"; }
fail() { log "FAIL: $*"; exit 1; }

# Normalize PG boolean text to t/f
norm_bool() {
  case "$(echo "$1" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')" in
    t|true) echo t ;;
    f|false) echo f ;;
    *) echo "$1" ;;
  esac
}

psql_root() { psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$ROOT_DB" "$@"; }
psql_db() { psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" "$@"; }

log "Preparing database $WORK_DB"
psql_root -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$WORK_DB' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
psql_root -c "DROP DATABASE IF EXISTS $WORK_DB;"
psql_root -c "CREATE DATABASE $WORK_DB;"

apply_migrations_as() {
  local role_sql="$1"
  psql_db -f "$STUBS_DIR/00_auth_and_roles.sql"
  if [[ -n "$role_sql" ]]; then
    psql_db -c "$role_sql"
  fi
  local f
  for f in \
    001_initial_multitenant.sql \
    002_business_tables_rls.sql \
    003_secure_org_policies.sql \
    004_default_privs_and_profile.sql \
    005_organization_invitations.sql \
    006_invite_fk_indexes_and_single_org_create.sql \
    007_secure_invitation_privacy_and_validation.sql \
    008_rls_helper_schema_and_profile_policy_optimization.sql
  do
    log "Applying $f"
    if [[ "$SCENARIO" == "setrole" ]]; then
      { echo "SET ROLE custom_owner;"; cat "$MIGRATIONS_DIR/$f"; echo "RESET ROLE;"; } | psql_db
    elif [[ "$SCENARIO" == "create" ]]; then
      { echo "SET SESSION AUTHORIZATION custom_owner;"; cat "$MIGRATIONS_DIR/$f"; echo "RESET SESSION AUTHORIZATION;"; } | psql_db
    else
      psql_db -f "$MIGRATIONS_DIR/$f"
    fi
  done
}

verify_post_008() {
  log "Running post-008 verification queries"

  local schema_owner
  schema_owner=$(psql_db -Atc "SELECT r.rolname FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner WHERE n.nspname = 'private';" | tr -d '[:space:]')
  [[ -n "$schema_owner" ]] || fail "private schema missing"
  [[ "$schema_owner" != "anon" && "$schema_owner" != "authenticated" ]] || fail "private schema owned by API role: $schema_owner"
  pass "private schema owner=$schema_owner"

  local definer_line
  definer_line=$(psql_db -Atc "SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='user_organization_ids';" || true)
  echo "$definer_line" | grep -qi "SECURITY DEFINER" || fail "private.user_organization_ids definition lacks SECURITY DEFINER"
  pass "private.user_organization_ids is SECURITY DEFINER"
  echo "$definer_line" | grep -q "search_path" || fail "search_path not in function definition"
  pass "private.user_organization_ids sets search_path"

  local pub_count
  pub_count=$(psql_db -Atc "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('user_organization_ids','user_active_organization_ids');" | tr -d '[:space:]')
  [[ "$pub_count" == "0" ]] || fail "public helper functions still exist (count=$pub_count)"
  pass "public helpers dropped"

  local pol_count
  pol_count=$(psql_db -Atc "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND (coalesce(qual,'') LIKE '%private.user_organization_ids%' OR coalesce(with_check,'') LIKE '%private.user_organization_ids%');" | tr -d '[:space:]')
  [[ "$pol_count" -ge 2 ]] || fail "expected >=2 policies using private.user_organization_ids, got $pol_count"
  pass "policies reference private.user_organization_ids (count=$pol_count)"

  local inv_a inv_b
  inv_a=$(norm_bool "$(psql_db -Atc "SELECT has_table_privilege('authenticated','public.organization_invitations','SELECT');")")
  inv_b=$(norm_bool "$(psql_db -Atc "SELECT has_table_privilege('anon','public.organization_invitations','SELECT');")")
  [[ "$inv_a" == "f" && "$inv_b" == "f" ]] || fail "organization_invitations still has SELECT for API roles: $inv_a,$inv_b"
  pass "organization_invitations has no SELECT for authenticated/anon"

  local uid org_id
  uid=$(psql_db -Atc "INSERT INTO auth.users (email) VALUES ('verify@example.com') RETURNING id;" | tr -d '[:space:]')
  org_id=$(psql_db -Atc "INSERT INTO public.organizations (name) VALUES ('Verify Org') RETURNING id;" | tr -d '[:space:]')
  psql_db -c "INSERT INTO public.organization_members (organization_id, user_id, role, status) VALUES ('$org_id', '$uid', 'owner', 'active');" >/dev/null
  psql_db -c "SELECT auth.set_test_uid('$uid'::uuid);" >/dev/null

  local returned
  returned=$(psql_db -Atc "SELECT private.user_organization_ids();" | tr -d '[:space:]')
  [[ "$returned" == "$org_id" ]] || fail "helper returned '$returned', expected '$org_id'"
  pass "private.user_organization_ids returns active membership"

  local usage_auth usage_anon
  usage_auth=$(norm_bool "$(psql_db -Atc "SELECT has_schema_privilege('authenticated','private','USAGE');")")
  usage_anon=$(norm_bool "$(psql_db -Atc "SELECT has_schema_privilege('anon','private','USAGE');")")
  [[ "$usage_auth" == "t" ]] || fail "authenticated lacks USAGE on private (got $usage_auth)"
  [[ "$usage_anon" == "f" ]] || fail "anon has USAGE on private (got $usage_anon)"
  pass "schema private USAGE: authenticated=yes, anon=no"
}

case "$SCENARIO" in
  safe) apply_migrations_as "" ;;
  create)
    apply_migrations_as "
      DO \$\$ BEGIN CREATE ROLE custom_owner LOGIN PASSWORD 'custom' NOSUPERUSER NOBYPASSRLS;
      EXCEPTION WHEN duplicate_object THEN ALTER ROLE custom_owner WITH LOGIN PASSWORD 'custom' NOSUPERUSER NOBYPASSRLS; END \$\$;
      GRANT ALL ON SCHEMA public TO custom_owner;
      GRANT ALL ON SCHEMA auth TO custom_owner;
      GRANT ALL ON TABLE auth.users TO custom_owner;
      GRANT CREATE ON DATABASE $WORK_DB TO custom_owner;
      GRANT custom_owner TO $PGUSER;
    " ;;
  setrole)
    apply_migrations_as "
      DO \$\$ BEGIN CREATE ROLE custom_owner NOSUPERUSER NOBYPASSRLS NOLOGIN;
      EXCEPTION WHEN duplicate_object THEN ALTER ROLE custom_owner WITH NOSUPERUSER NOBYPASSRLS; END \$\$;
      GRANT ALL ON SCHEMA public TO custom_owner;
      GRANT ALL ON SCHEMA auth TO custom_owner;
      GRANT ALL ON TABLE auth.users TO custom_owner;
      GRANT CREATE ON DATABASE $WORK_DB TO custom_owner;
      GRANT custom_owner TO $PGUSER;
    " ;;
  *) fail "Unknown SCENARIO=$SCENARIO" ;;
esac

verify_post_008
log "SCENARIO COMPLETE: PASS"
exit 0
