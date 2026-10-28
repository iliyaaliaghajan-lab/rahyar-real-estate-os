#!/usr/bin/env bash
# Isolated PostgreSQL matrix for migration 008.
# Positive: safe | create | setrole
# Negative (expect SECURITY PREFLIGHT FAILED):
#   neg_schema_owner_member  – API role inherits schema owner
#   neg_function_owner_member – API role inherits/becomes function owner (schema owner distinct; preflight A)
#   neg_function_owner_preflight_c – post-create membership injection; exercises preflight C only
#   neg_create_inherit       – API role obtains CREATE via role membership (USAGE/INHERIT)
#   neg_create_setrole       – API role obtains CREATE via SET ROLE (PG16+) or MEMBER without inherit (PG15)
# Never soft-fail security checks. Never use || true to hide expected failures.
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

norm_bool() {
  case "$(echo "$1" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')" in
    t|true) echo t ;;
    f|false) echo f ;;
    *) echo "$1" ;;
  esac
}

# Extract first UUID from psql output (handles accidental INSERT tags / notices).
extract_uuid() {
  echo "$1" | grep -oE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' | head -1
}

psql_root() { psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$ROOT_DB" "$@"; }
psql_db() { psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" "$@"; }

log "Preparing database $WORK_DB"
psql_root -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$WORK_DB' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
psql_root -c "DROP DATABASE IF EXISTS $WORK_DB;"
psql_root -c "CREATE DATABASE $WORK_DB;"

apply_001_to_007() {
  local role_mode="${1:-safe}"
  psql_db -f "$STUBS_DIR/00_auth_and_roles.sql"
  if [[ "$role_mode" == "create" || "$role_mode" == "setrole" ]]; then
    psql_db -c "
      DO \$\$ BEGIN
        CREATE ROLE custom_owner LOGIN PASSWORD 'custom' NOSUPERUSER NOBYPASSRLS;
      EXCEPTION WHEN duplicate_object THEN
        ALTER ROLE custom_owner WITH LOGIN PASSWORD 'custom' NOSUPERUSER NOBYPASSRLS;
      END \$\$;
      GRANT ALL ON SCHEMA public TO custom_owner;
      GRANT ALL ON SCHEMA auth TO custom_owner;
      GRANT ALL ON TABLE auth.users TO custom_owner;
      GRANT CREATE ON DATABASE $WORK_DB TO custom_owner;
      GRANT custom_owner TO $PGUSER;
      ALTER TABLE public.properties OWNER TO custom_owner;
      ALTER TABLE public.clients OWNER TO custom_owner;
      ALTER TABLE public.needs OWNER TO custom_owner;
      ALTER TABLE public.follow_ups OWNER TO custom_owner;
      ALTER TABLE public.activities OWNER TO custom_owner;
    "
  fi
  local f
  for f in \
    001_initial_multitenant.sql \
    002_business_tables_rls.sql \
    003_secure_org_policies.sql \
    004_default_privs_and_profile.sql \
    005_organization_invitations.sql \
    006_invite_fk_indexes_and_single_org_create.sql \
    007_secure_invitation_privacy_and_validation.sql
  do
    log "Applying $f"
    if [[ "$role_mode" == "setrole" ]]; then
      { echo "SET ROLE custom_owner;"; cat "$MIGRATIONS_DIR/$f"; echo "RESET ROLE;"; } | psql_db
    elif [[ "$role_mode" == "create" ]]; then
      { echo "SET SESSION AUTHORIZATION custom_owner;"; cat "$MIGRATIONS_DIR/$f"; echo "RESET SESSION AUTHORIZATION;"; } | psql_db
    else
      psql_db -f "$MIGRATIONS_DIR/$f"
    fi
  done
}

apply_008() {
  local role_mode="${1:-safe}"
  log "Applying 008"
  if [[ "$role_mode" == "setrole" ]]; then
    { echo "SET ROLE custom_owner;"; cat "$MIGRATIONS_DIR/008_rls_helper_schema_and_profile_policy_optimization.sql"; echo "RESET ROLE;"; } | psql_db
  elif [[ "$role_mode" == "create" ]]; then
    { echo "SET SESSION AUTHORIZATION custom_owner;"; cat "$MIGRATIONS_DIR/008_rls_helper_schema_and_profile_policy_optimization.sql"; echo "RESET SESSION AUTHORIZATION;"; } | psql_db
  else
    psql_db -f "$MIGRATIONS_DIR/008_rls_helper_schema_and_profile_policy_optimization.sql"
  fi
}

# Apply migration 008 expecting SECURITY PREFLIGHT FAILED.
# Args: expected_snippet, role_mode [safe|create|setrole|fn_owner_c], optional required_fixture_marker
expect_preflight_fail() {
  local expected_snippet="$1"
  local role_mode="${2:-safe}"
  local required_marker="${3:-}"
  local out; out=$(mktemp)
  set +e
  case "$role_mode" in
    setrole)
      { echo "SET ROLE custom_owner;"; cat "$MIGRATIONS_DIR/008_rls_helper_schema_and_profile_policy_optimization.sql"; echo "RESET ROLE;"; } | psql_db >"$out" 2>&1
      ;;
    create)
      { echo "SET SESSION AUTHORIZATION custom_owner;"; cat "$MIGRATIONS_DIR/008_rls_helper_schema_and_profile_policy_optimization.sql"; echo "RESET SESSION AUTHORIZATION;"; } | psql_db >"$out" 2>&1
      ;;
    fn_owner_c)
      # Run as fn_owner_c so CREATE FUNCTION yields that owner; event trigger then injects membership before preflight C.
      { echo "SET ROLE fn_owner_c;"; cat "$MIGRATIONS_DIR/008_rls_helper_schema_and_profile_policy_optimization.sql"; echo "RESET ROLE;"; } | psql_db >"$out" 2>&1
      ;;
    *)
      psql_db -f "$MIGRATIONS_DIR/008_rls_helper_schema_and_profile_policy_optimization.sql" >"$out" 2>&1
      ;;
  esac
  local rc=$?
  set -e
  if [[ $rc -eq 0 ]]; then
    log "008 output (unexpected success):"
    cat "$out" || true
    rm -f "$out"
    fail "008 succeeded but expected SECURITY PREFLIGHT FAILED ($expected_snippet)"
  fi
  if [[ -n "$required_marker" ]] && ! grep -q "$required_marker" "$out"; then
    log "008 output (missing required fixture marker '$required_marker'):"
    cat "$out" || true
    rm -f "$out"
    fail "required fixture marker '$required_marker' absent — preflight C injection did not run"
  fi
  if ! grep -q "SECURITY PREFLIGHT FAILED" "$out"; then
    log "008 output (missing SECURITY PREFLIGHT FAILED marker):"
    cat "$out" || true
    rm -f "$out"
    fail "008 failed without SECURITY PREFLIGHT FAILED marker"
  fi
  if ! grep -qi "$expected_snippet" "$out"; then
    log "008 output (missing expected snippet '$expected_snippet'):"
    cat "$out" || true
    rm -f "$out"
    fail "SECURITY PREFLIGHT FAILED present, missing detail '$expected_snippet'"
  fi
  log "preflight message: $(grep -o 'SECURITY PREFLIGHT FAILED:.*' "$out" | head -1)"
  if [[ -n "$required_marker" ]]; then
    log "fixture marker confirmed: $required_marker"
  fi
  rm -f "$out"
  pass "008 aborted with SECURITY PREFLIGHT FAILED containing: $expected_snippet"
}

verify_post_008_positive() {
  log "Running post-008 positive verification"
  local schema_owner
  schema_owner=$(psql_db -Atc "SELECT r.rolname FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner WHERE n.nspname = 'private';" | tr -d '[:space:]')
  [[ -n "$schema_owner" ]] || fail "private schema missing"
  [[ "$schema_owner" != "anon" && "$schema_owner" != "authenticated" ]] || fail "private schema owned by API role: $schema_owner"
  pass "private schema owner=$schema_owner"

  local definer_line
  set +e
  definer_line=$(psql_db -Atc "SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='user_organization_ids';")
  local def_rc=$?
  set -e
  [[ $def_rc -eq 0 && -n "$definer_line" ]] || fail "could not fetch private.user_organization_ids definition"
  echo "$definer_line" | grep -qi "SECURITY DEFINER" || fail "not SECURITY DEFINER"
  pass "private.user_organization_ids is SECURITY DEFINER"
  echo "$definer_line" | grep -q "search_path" || fail "search_path missing"
  pass "private.user_organization_ids sets search_path"

  local fn_owner
  fn_owner=$(psql_db -Atc "SELECT r.rolname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='private' AND p.proname='user_organization_ids';" | tr -d '[:space:]')
  [[ -n "$fn_owner" ]] || fail "function owner missing"
  [[ "$fn_owner" != "anon" && "$fn_owner" != "authenticated" ]] || fail "function owned by API role: $fn_owner"
  pass "function owner=$fn_owner"

  local pub_count
  pub_count=$(psql_db -Atc "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('user_organization_ids','user_active_organization_ids');" | tr -d '[:space:]')
  [[ "$pub_count" == "0" ]] || fail "public helpers still exist (count=$pub_count)"
  pass "public helpers dropped"

  local pol_count
  pol_count=$(psql_db -Atc "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND (coalesce(qual,'') LIKE '%private.user_organization_ids%' OR coalesce(with_check,'') LIKE '%private.user_organization_ids%');" | tr -d '[:space:]')
  [[ "$pol_count" -ge 2 ]] || fail "expected >=2 policies, got $pol_count"
  pass "policies reference private helper (count=$pol_count)"

  local inv_a inv_b
  inv_a=$(norm_bool "$(psql_db -Atc "SELECT has_table_privilege('authenticated','public.organization_invitations','SELECT');")")
  inv_b=$(norm_bool "$(psql_db -Atc "SELECT has_table_privilege('anon','public.organization_invitations','SELECT');")")
  [[ "$inv_a" == "f" && "$inv_b" == "f" ]] || fail "invitations SELECT leak: $inv_a,$inv_b"
  pass "organization_invitations locked"

  local new_uid profile_count_after raw
  set +e
  raw=$(psql_db -Atc "INSERT INTO auth.users (email, raw_user_meta_data) VALUES ('trigger-check@example.com', '{\"full_name\":\"T\"}'::jsonb) RETURNING id;")
  local ins_rc=$?
  set -e
  [[ $ins_rc -eq 0 ]] || fail "auth.users trigger-check insert failed (rc=$ins_rc raw=$raw)"
  new_uid=$(extract_uuid "$raw")
  [[ -n "$new_uid" ]] || fail "could not parse uuid from auth insert: $raw"
  profile_count_after=$(psql_db -Atc "SELECT count(*) FROM public.profiles WHERE id = '$new_uid';" | tr -d '[:space:]')
  [[ "$profile_count_after" == "1" ]] || fail "auth.users trigger did not create profile (count=$profile_count_after uid=$new_uid)"
  pass "auth.users trigger created profile"

  local uid org_id returned helper_out
  set +e
  raw=$(psql_db -Atc "INSERT INTO auth.users (email) VALUES ('verify@example.com') RETURNING id;")
  ins_rc=$?
  set -e
  [[ $ins_rc -eq 0 ]] || fail "verify user insert failed (rc=$ins_rc raw=$raw)"
  uid=$(extract_uuid "$raw")
  set +e
  raw=$(psql_db -Atc "INSERT INTO public.organizations (name) VALUES ('Verify Org') RETURNING id;")
  ins_rc=$?
  set -e
  [[ $ins_rc -eq 0 ]] || fail "organization insert failed (rc=$ins_rc raw=$raw)"
  org_id=$(extract_uuid "$raw")
  [[ -n "$uid" && -n "$org_id" ]] || fail "smoke insert ids missing uid='$uid' org='$org_id'"
  [[ "$uid" != "$org_id" ]] || fail "uid and org_id unexpectedly equal ($uid)"

  set +e
  psql_db -c "INSERT INTO public.organization_members (organization_id, user_id, role, status) VALUES ('$org_id', '$uid', 'owner', 'active');" >/dev/null
  ins_rc=$?
  set -e
  [[ $ins_rc -eq 0 ]] || fail "organization_members insert failed (rc=$ins_rc)"

  set +e
  helper_out=$(psql_db -Atc "
    SELECT auth.set_test_uid('$uid'::uuid);
    SELECT private.user_organization_ids();
  ")
  local helper_rc=$?
  set -e
  [[ $helper_rc -eq 0 ]] || fail "helper smoke session failed (rc=$helper_rc out=$helper_out)"
  returned=$(extract_uuid "$helper_out")
  [[ -n "$returned" ]] || fail "helper returned no uuid (raw out='$helper_out' expected org=$org_id uid=$uid)"
  [[ "$returned" == "$org_id" ]] || fail "helper returned '$returned' expected org_id='$org_id' (uid=$uid raw='$helper_out')"
  pass "helper returns active membership (org=$org_id)"

  local usage_auth usage_anon create_auth create_anon
  usage_auth=$(norm_bool "$(psql_db -Atc "SELECT has_schema_privilege('authenticated','private','USAGE');")")
  usage_anon=$(norm_bool "$(psql_db -Atc "SELECT has_schema_privilege('anon','private','USAGE');")")
  create_auth=$(norm_bool "$(psql_db -Atc "SELECT has_schema_privilege('authenticated','private','CREATE');")")
  create_anon=$(norm_bool "$(psql_db -Atc "SELECT has_schema_privilege('anon','private','CREATE');")")
  [[ "$usage_auth" == "t" ]] || fail "authenticated lacks USAGE (got $usage_auth)"
  [[ "$usage_anon" == "f" ]] || fail "anon has USAGE (got $usage_anon)"
  [[ "$create_auth" == "f" ]] || fail "authenticated has CREATE (got $create_auth)"
  [[ "$create_anon" == "f" ]] || fail "anon has CREATE (got $create_anon)"
  pass "schema ACL: USAGE auth only; CREATE none for API"

  local biz_policies
  biz_policies=$(psql_db -Atc "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename IN ('properties','clients','needs','follow_ups','activities') AND coalesce(qual,'') LIKE '%private.user_organization_ids%' AND coalesce(with_check,'') LIKE '%private.user_organization_ids%';" | tr -d '[:space:]')
  [[ "$biz_policies" -ge 5 ]] || fail "expected >=5 business policies, got $biz_policies"
  pass "business-table dynamic policies (count=$biz_policies)"
}

case "$SCENARIO" in
  safe) apply_001_to_007 safe; apply_008 safe; verify_post_008_positive ;;
  create) apply_001_to_007 create; apply_008 create; verify_post_008_positive ;;
  setrole) apply_001_to_007 setrole; apply_008 setrole; verify_post_008_positive ;;

  neg_schema_owner_member)
    apply_001_to_007 safe
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
    expect_preflight_fail "for schema private"
    ;;

  neg_function_owner_member)
    apply_001_to_007 safe
    ver=$(psql_db -Atc "SHOW server_version_num;" | tr -d '[:space:]')
    if [[ "$ver" -ge 160000 ]]; then
      psql_db -c "
        CREATE SCHEMA IF NOT EXISTS private AUTHORIZATION postgres;
        CREATE ROLE fn_owner_role NOSUPERUSER NOBYPASSRLS NOLOGIN;
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
        CREATE SCHEMA IF NOT EXISTS private AUTHORIZATION postgres;
        CREATE ROLE fn_owner_role NOSUPERUSER NOBYPASSRLS NOLOGIN;
        GRANT USAGE ON SCHEMA private TO fn_owner_role;
        CREATE OR REPLACE FUNCTION private.user_organization_ids()
          RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
          AS \$\$ SELECT organization_id FROM public.organization_members
                 WHERE user_id = (SELECT auth.uid()) AND status = 'active' \$\$;
        ALTER FUNCTION private.user_organization_ids() OWNER TO fn_owner_role;
        GRANT fn_owner_role TO authenticated;
      "
    fi
    expect_preflight_fail "function private.user_organization_ids()"
    ;;

  neg_create_inherit)
    apply_001_to_007 safe
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
        ALTER ROLE authenticated NOINHERIT;
        GRANT create_holder_set TO authenticated;
      "
      create_eff=$(norm_bool "$(psql_db -Atc "SELECT has_schema_privilege('authenticated','private','CREATE');")")
      member_ok=$(norm_bool "$(psql_db -Atc "SELECT pg_has_role('authenticated','create_holder_set','MEMBER');")")
      [[ "$create_eff" == "f" ]] || fail "PG15 fixture: authenticated still has effective CREATE (got $create_eff); NOINHERIT did not isolate membership path"
      [[ "$member_ok" == "t" ]] || fail "PG15 fixture: authenticated is not MEMBER of create_holder_set (got $member_ok)"
      pass "PG15 fixture: no effective CREATE; MEMBER of create_holder_set confirmed"
      expect_preflight_fail "can become role"
    fi
    ;;

  neg_function_owner_preflight_c)
    # Goal: pass preflight A and B, create the helper as fn_owner_c, then inject
    # API membership via a test-only ddl_command_end event trigger so preflight C fires.
    apply_001_to_007 safe
    ver=$(psql_db -Atc "SHOW server_version_num;" | tr -d '[:space:]')
    psql_db -c "
      -- Dedicated owner role: not granted to API roles before helper creation.
      DO \$\$ BEGIN
        CREATE ROLE fn_owner_c NOSUPERUSER NOBYPASSRLS NOLOGIN;
      EXCEPTION WHEN duplicate_object THEN
        ALTER ROLE fn_owner_c WITH NOSUPERUSER NOBYPASSRLS NOLOGIN;
      END \$\$;
      -- Current superuser must be able to SET ROLE during the migration apply.
      GRANT fn_owner_c TO CURRENT_USER;
      -- Schema exists and is owned by fn_owner_c; helper must NOT exist yet.
      DROP FUNCTION IF EXISTS private.user_organization_ids();
      CREATE SCHEMA IF NOT EXISTS private AUTHORIZATION fn_owner_c;
      -- Ensure API roles have no membership path to fn_owner_c before migration.
      REVOKE fn_owner_c FROM authenticated;
      REVOKE fn_owner_c FROM anon;

      -- Test-only event trigger: after private.user_organization_ids is created,
      -- grant membership so preflight C sees an unsafe function-owner path.
      CREATE OR REPLACE FUNCTION public.m008_test_c_on_helper_create()
      RETURNS event_trigger
      LANGUAGE plpgsql
      SET search_path = pg_catalog
      AS \$\$
      DECLARE
        r record;
        ver integer := current_setting('server_version_num')::integer;
        matched boolean := false;
      BEGIN
        FOR r IN
          SELECT c.schema_name, c.object_identity, c.object_type, c.command_tag
          FROM pg_catalog.pg_event_trigger_ddl_commands() AS c
        LOOP
          IF r.object_type = 'function'
             AND (
               (r.schema_name = 'private' AND position('user_organization_ids' in r.object_identity) > 0)
               OR r.object_identity LIKE 'private.user_organization_ids%'
             )
          THEN
            matched := true;
            RAISE NOTICE 'M008_TEST_C_FIXTURE: granting fn_owner_c to authenticated after helper create (identity=%)',
              r.object_identity;
            IF ver >= 160000 THEN
              EXECUTE 'GRANT fn_owner_c TO authenticated WITH INHERIT TRUE, SET TRUE';
            ELSE
              EXECUTE 'GRANT fn_owner_c TO authenticated';
            END IF;
          END IF;
        END LOOP;
        IF NOT matched THEN
          RAISE NOTICE 'M008_TEST_C_FIXTURE: ddl_command_end saw no private.user_organization_ids create';
        END IF;
      END;
      \$\$;

      DROP EVENT TRIGGER IF EXISTS m008_test_c_helper_created;
      CREATE EVENT TRIGGER m008_test_c_helper_created
        ON ddl_command_end
        WHEN TAG IN ('CREATE FUNCTION')
        EXECUTE FUNCTION public.m008_test_c_on_helper_create();
    "
    # C-specific diagnostic uses the USAGE/inherit wording from preflight C.
    expect_preflight_fail "privileges of function owner" "fn_owner_c" "M008_TEST_C_FIXTURE"
    ;;

  *) fail "Unknown SCENARIO=$SCENARIO" ;;
esac

log "SCENARIO COMPLETE: PASS"
exit 0
