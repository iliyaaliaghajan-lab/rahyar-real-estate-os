#!/usr/bin/env bash
# Isolated Postgres P0 for cloud business data foundation (migration 009).
# Temporary DB only — never Staging/Production.
set -euo pipefail

PGHOST="${PGHOST:-/var/run/postgresql}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
export PGHOST PGPORT PGUSER
if [[ -n "${PGPASSWORD:-}" ]]; then export PGPASSWORD; else unset PGPASSWORD 2>/dev/null || true; fi

MIGRATIONS_DIR="${MIGRATIONS_DIR:-supabase/migrations}"
STUBS_DIR="${STUBS_DIR:-scripts/isolated-pg}"
ROOT_DB="postgres"
WORK_DB="rahyar_cloud_p0_$$"

log() { printf '[cloud-p0] %s\n' "$*"; }
pass() { log "PASS: $*"; }
fail() { log "FAIL: $*"; exit 1; }

is_loopback_ip() { case "$1" in 127.*|::1|0:0:0:0:0:0:0:1) return 0 ;; *) return 1 ;; esac; }
is_local_socket_path() { case "$1" in /var/run/postgresql|/var/run/postgresql/*|/tmp|/tmp/*|/run/postgresql|/run/postgresql/*) return 0 ;; *) return 1 ;; esac; }
is_valid_ipv4() {
  local ip="$1"; [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  local o; IFS=. read -r -a parts <<< "$ip"
  for o in "${parts[@]}"; do [[ "$o" =~ ^[0-9]+$ ]] || return 1; (( 10#$o >= 0 && 10#$o <= 255 )) || return 1; done
  return 0
}
is_loopback_pghost() { local host="${PGHOST:-}"; [[ -z "$host" || "$host" == "localhost" ]] && return 0; is_loopback_ip "$host" && return 0; return 1; }

assert_local_target() {
  if [[ -n "${PGHOSTADDR:-}" ]] && ! is_loopback_ip "$PGHOSTADDR"; then fail "Refusing non-loopback PGHOSTADDR='${PGHOSTADDR}'."; fi
  local host="$PGHOST"
  if [[ -z "$host" || "$host" == "localhost" ]]; then :
  elif is_loopback_ip "$host"; then :
  elif is_local_socket_path "$host"; then :
  else fail "Refusing PGHOST='${host}'. Only localhost/loopback/Unix socket allowed."; fi
}

assert_server_is_local() {
  local addr
  addr=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$ROOT_DB" -At -c "SELECT COALESCE(host(inet_server_addr()), '');" 2>/dev/null || echo "QUERY_FAILED")
  if [[ "$addr" == "QUERY_FAILED" ]]; then fail "Could not query inet_server_addr(); refusing to proceed."; fi
  if [[ -z "$addr" ]]; then log "Server address check: Unix socket — allowed"; return 0; fi
  if is_loopback_ip "$addr"; then log "Server address check: ${addr} (loopback) — allowed"; return 0; fi
  if [[ "${GITHUB_ACTIONS:-}" == "true" && "${P0_ALLOW_SERVICE_CONTAINER:-}" == "1" && -n "${P0_ALLOWED_SERVER_ADDR:-}" ]]; then
    if ! is_loopback_pghost; then fail "CI service-container exception requires loopback PGHOST."; fi
    if [[ -n "${PGHOSTADDR:-}" ]] && ! is_loopback_ip "$PGHOSTADDR"; then fail "CI service-container exception requires empty/loopback PGHOSTADDR."; fi
    if ! is_valid_ipv4 "$P0_ALLOWED_SERVER_ADDR"; then fail "P0_ALLOWED_SERVER_ADDR is not a valid IPv4."; fi
    if [[ "$addr" == "$P0_ALLOWED_SERVER_ADDR" ]]; then log "Server address check: ${addr} matches inspected GHA postgres service — allowed"; return 0; fi
    fail "Refusing inet_server_addr()='${addr}' (expected '${P0_ALLOWED_SERVER_ADDR}')."
  fi
  fail "Refusing non-loopback inet_server_addr()='${addr}'."
}

extract_uuid() { echo "$1" | grep -oE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' | head -1; }
psql_root() { psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$ROOT_DB" "$@"; }
q() { psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -At -c "$1"; }
psql_db() { psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" "$@"; }

as_auth() {
  local uid="$1"; local sql="$2"
  psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -At <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SELECT auth.set_test_uid('$uid');
$sql
COMMIT;
SQL
}

cleanup() {
  if [[ "${SAFETY_OK:-0}" != "1" ]]; then return 0; fi
  log "Cleanup: drop $WORK_DB"
  psql_root -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$WORK_DB' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
  psql_root -c "DROP DATABASE IF EXISTS $WORK_DB;" >/dev/null 2>&1 || true
}
trap cleanup EXIT

log "Safety: validating local-only PostgreSQL target"
assert_local_target
assert_server_is_local
SAFETY_OK=1

log "Preparing database $WORK_DB"
psql_root -c "DROP DATABASE IF EXISTS $WORK_DB;" >/dev/null 2>&1 || true
psql_root -c "CREATE DATABASE $WORK_DB;"

log "Applying stubs + 9 migrations"
psql_db -f "$STUBS_DIR/00_auth_and_roles.sql" >/dev/null
for f in \
  20261022230848_initial_multitenant.sql \
  20261022230858_business_tables_rls.sql \
  20261022230904_secure_org_policies.sql \
  20261022230911_default_privs_and_profile.sql \
  20261022230925_organization_invitations.sql \
  20261026115345_secure_invitation_privacy_and_validation.sql \
  20261027003152_invite_fk_indexes_and_single_org_create.sql \
  20261029181022_rls_helper_schema_and_profile_policy_optimization.sql \
  20261112120000_cloud_business_data_foundation.sql
do
  log "  -> $f"
  psql_db -f "$MIGRATIONS_DIR/$f" >/dev/null
done

log "=== Schema presence + RLS enabled ==="
for t in properties clients needs follow_ups activities; do
  c=$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='$t';")
  [[ "$c" == "1" ]] || fail "table $t missing"
  rls=$(q "SELECT relrowsecurity::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='$t';")
  [[ "$rls" == "t" ]] || fail "RLS not enabled on $t"
done
pass "five business tables exist with RLS enabled"

log "=== Seed two orgs + dual member ==="
ua=$(extract_uuid "$(q "INSERT INTO auth.users (email) VALUES ('a@test.local') RETURNING id;")")
ub=$(extract_uuid "$(q "INSERT INTO auth.users (email) VALUES ('b@test.local') RETURNING id;")")
uc=$(extract_uuid "$(q "INSERT INTO auth.users (email) VALUES ('nomember@test.local') RETURNING id;")")
ud=$(extract_uuid "$(q "INSERT INTO auth.users (email) VALUES ('dual@test.local') RETURNING id;")")
q "INSERT INTO public.profiles (id, full_name) VALUES ('$ua','A'),('$ub','B'),('$uc','C'),('$ud','Dual') ON CONFLICT DO NOTHING;" >/dev/null
oa=$(extract_uuid "$(q "INSERT INTO public.organizations (name, slug) VALUES ('OrgA','org-a-$$') RETURNING id;")")
ob=$(extract_uuid "$(q "INSERT INTO public.organizations (name, slug) VALUES ('OrgB','org-b-$$') RETURNING id;")")
q "INSERT INTO public.organization_members (organization_id, user_id, role, status, joined_at)
   VALUES
     ('$oa','$ua','owner','active',now()),
     ('$ob','$ub','owner','active',now()),
     ('$oa','$ud','agent','active',now()),
     ('$ob','$ud','agent','active',now());" >/dev/null

ca=$(extract_uuid "$(as_auth "$ua" "INSERT INTO public.clients (organization_id, name, created_by, updated_by) VALUES ('$oa','Client A','$ua','$ua') RETURNING id;")")
cb=$(extract_uuid "$(as_auth "$ub" "INSERT INTO public.clients (organization_id, name, created_by, updated_by) VALUES ('$ob','Client B','$ub','$ub') RETURNING id;")")
[[ -n "$ca" && -n "$cb" ]] || fail "client seed failed"
pa=$(extract_uuid "$(as_auth "$ua" "INSERT INTO public.properties (organization_id, title, created_by, updated_by) VALUES ('$oa','Prop A','$ua','$ua') RETURNING id;")")
pb=$(extract_uuid "$(as_auth "$ub" "INSERT INTO public.properties (organization_id, title, created_by, updated_by) VALUES ('$ob','Prop B','$ub','$ub') RETURNING id;")")
[[ -n "$pa" && -n "$pb" ]] || fail "property seed failed"
na=$(extract_uuid "$(as_auth "$ua" "INSERT INTO public.needs (organization_id, client_id, created_by, updated_by) VALUES ('$oa','$ca','$ua','$ua') RETURNING id;")")
nb=$(extract_uuid "$(as_auth "$ub" "INSERT INTO public.needs (organization_id, client_id, created_by, updated_by) VALUES ('$ob','$cb','$ub','$ub') RETURNING id;")")
[[ -n "$na" && -n "$nb" ]] || fail "need seed failed"
fa=$(extract_uuid "$(as_auth "$ua" "INSERT INTO public.follow_ups (organization_id, client_id, property_id, title, created_by, updated_by) VALUES ('$oa','$ca','$pa','FU A','$ua','$ua') RETURNING id;")")
[[ -n "$fa" ]] || fail "follow_up seed failed"

log "=== C1: anon has no table privileges ==="
for t in properties clients needs follow_ups activities; do
  for priv in SELECT INSERT UPDATE DELETE; do
    has=$(q "SELECT has_table_privilege('anon', 'public.$t', '$priv')::text;")
    [[ "$has" == "false" ]] || fail "anon must not have $priv on $t (got $has)"
  done
done
set +e
err=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -c "
  BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM public.clients; COMMIT;" 2>&1)
rc=$?
set -e
[[ $rc -ne 0 ]] || fail "anon SELECT clients must fail at runtime"
pass "anon has no SELECT/INSERT/UPDATE/DELETE on any business table"

log "=== C2: non-member sees zero ==="
n=$(as_auth "$uc" "SELECT count(*) FROM public.clients;" | grep -E '^[0-9]+$' | tail -1)
[[ "${n:-x}" == "0" ]] || fail "non-member should see 0 clients, got $n"
pass "non-member sees 0 clients"

log "=== C3: tenant isolation SELECT ==="
n=$(as_auth "$ua" "SELECT count(*) FROM public.clients;" | grep -E '^[0-9]+$' | tail -1)
[[ "$n" == "1" ]] || fail "owner A should see 1 client, got $n"
n=$(as_auth "$ua" "SELECT count(*) FROM public.clients WHERE id = '$cb';" | grep -E '^[0-9]+$' | tail -1)
[[ "$n" == "0" ]] || fail "owner A must not see client B"
pass "tenant isolation on clients"

log "=== C4: composite FK blocks cross-org need ==="
set +e
err=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -c "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$ua');
  INSERT INTO public.needs (organization_id, client_id, created_by, updated_by)
  VALUES ('$oa', '$cb', '$ua', '$ua');
  COMMIT;" 2>&1)
rc=$?
set -e
[[ $rc -ne 0 ]] || fail "cross-org need insert must fail"
echo "$err" | grep -qiE "foreign key|23503" || fail "expected FK violation, got: $err"
pass "composite FK rejects cross-org need"

log "=== C5: organization_id immutable (single + dual member) ==="
set +e
err=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -c "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$ua');
  UPDATE public.clients SET organization_id = '$ob', updated_by = '$ua' WHERE id = '$ca';
  COMMIT;" 2>&1)
rc=$?
set -e
[[ $rc -ne 0 ]] || fail "org_id change by owner must fail"
echo "$err" | grep -qiE "organization_id cannot be changed|23514" || log "note: error text=$err"
final=$(q "SELECT organization_id::text FROM public.clients WHERE id = '$ca';")
[[ "$final" == "$oa" ]] || fail "org_id changed unexpectedly to $final"

for t_id_pair in "clients:$ca" "properties:$pa" "needs:$na" "follow_ups:$fa"; do
  t="${t_id_pair%%:*}"
  rid="${t_id_pair##*:}"
  set +e
  err=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -c "
    BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$ud');
    UPDATE public.$t SET organization_id = '$ob', updated_by = '$ud' WHERE id = '$rid';
    COMMIT;" 2>&1)
  rc=$?
  set -e
  [[ $rc -ne 0 ]] || fail "dual-member org_id change on $t must fail (trigger)"
  echo "$err" | grep -qiE "organization_id cannot be changed|23514" || log "note dual $t: $err"
  final=$(q "SELECT organization_id::text FROM public.$t WHERE id = '$rid';")
  [[ "$final" == "$oa" ]] || fail "dual-member changed org_id on $t to $final"
done
pass "organization_id immutable (owner + dual-member; trigger not only RLS)"

log "=== C6: activities append-only ==="
aid=$(extract_uuid "$(as_auth "$ua" "INSERT INTO public.activities (organization_id, type, text, created_by) VALUES ('$oa','client','hello','$ua') RETURNING id;")")
[[ -n "$aid" ]] || fail "activity insert failed"
n=$(as_auth "$ua" "SELECT "SELECT count(*) FROM public.activities WHERE id = '$aid';" | grep -E '^[0-9]+$' | tail -1)
[[ "$n" == "1" ]] || fail "activity SELECT own failed"
set +e
err=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -c "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$ua');
  UPDATE public.activities SET text = 'x' WHERE id = '$aid';
  COMMIT;" 2>&1)
rc=$?
set -e
[[ $rc -ne 0 ]] || fail "activity UPDATE must fail"
set +e
err=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -c "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$ua');
  DELETE FROM public.activities WHERE id = '$aid';
  COMMIT;" 2>&1)
rc=$?
set -e
[[ $rc -ne 0 ]] || fail "activity DELETE must fail"
pass "activities are append-only (INSERT+SELECT only)"

log "=== C7: follow_up same-org property; dual-member cross-org rejected ==="
fid=$(extract_uuid "$(as_auth "$ua" "INSERT INTO public.follow_ups (organization_id, client_id, property_id, title, created_by, updated_by) VALUES ('$oa','$ca','$pa','FU2','$ua','$ua') RETURNING id;")")
[[ -n "$fid" ]] || fail "same-org follow_up insert failed"
set +e
err=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -c "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$ud');
  INSERT INTO public.follow_ups (organization_id, client_id, property_id, title, created_by, updated_by)
  VALUES ('$oa','$ca','$pb','bad dual','$ud','$ud');
  COMMIT;" 2>&1)
rc=$?
set -e
[[ $rc -ne 0 ]] || fail "dual-member cross-org property on follow_up must fail"
echo "$err" | grep -qiE "same organization|23514|23503" || log "note dual fu: $err"
pass "follow_up property same-org enforced (including dual-member)"

log "=== C8: created_by immutable on properties/clients/needs/follow_ups ==="
for t_id_pair in "clients:$ca" "properties:$pa" "needs:$na" "follow_ups:$fa"; do
  t="${t_id_pair%%:*}"
  rid="${t_id_pair##*:}"
  set +e
  err=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -c "
    BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$ua');
    UPDATE public.$t SET created_by = '$ub', updated_by = '$ua' WHERE id = '$rid';
    COMMIT;" 2>&1)
  rc=$?
  set -e
  [[ $rc -ne 0 ]] || fail "created_by change on $t must fail"
  echo "$err" | grep -qiE "created_by cannot be changed|23514" || log "note created_by $t: $err"
  final_cb=$(q "SELECT created_by::text FROM public.$t WHERE id = '$rid';")
  [[ "$final_cb" == "$ua" ]] || fail "created_by on $t changed to $final_cb"
done
set +e
err=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -c "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$ua');
  UPDATE public.activities SET created_by = '$ub' WHERE id = '$aid';
  COMMIT;" 2>&1)
rc=$?
set -e
[[ $rc -ne 0 ]] || fail "activity created_by UPDATE must fail (no UPDATE grant)"
pass "created_by immutable on four tables; activities no UPDATE"

log "=== C9: property DELETE sets follow_ups.property_id NULL; org_id unchanged ==="
cur=$(q "SELECT property_id::text FROM public.follow_ups WHERE id = '$fa';")
[[ "$cur" == "$pa" ]] || fail "precondition: follow_up should reference pa"
n=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -At -c "
  DO \$\$
  DECLARE n int;
  BEGIN
    PERFORM set_config('role', 'authenticated', true);
    PERFORM auth.set_test_uid('$ua');
    DELETE FROM public.properties WHERE id = '$pa';
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('role', 'none', true);
    RAISE NOTICE 'deleted=%', n;
  END \$\$;
" 2>&1 | grep -oE 'deleted=[0-9]+' | cut -d= -f2)
[[ "${n:-0}" == "1" ]] || fail "property DELETE should affect 1, got ${n:-none}"
prop_left=$(q "SELECT count(*) FROM public.properties WHERE id = '$pa';")
[[ "$prop_left" == "0" ]] || fail "property row should be gone"
fu_prop=$(q "SELECT property_id::text FROM public.follow_ups WHERE id = '$fa';")
[[ "$fu_prop" == "" ]] || fail "follow_ups.property_id should be NULL after property delete, got $fu_prop"
fu_org=$(q "SELECT organization_id::text FROM public.follow_ups WHERE id = '$fa';")
[[ "$fu_org" == "$oa" ]] || fail "follow_ups.organization_id must stay $oa, got $fu_org"
pass "property ON DELETE SET NULL; organization_id unchanged"

log "=== C10: authenticated privilege matrix ==="
for t in properties clients needs follow_ups; do
  for priv in SELECT INSERT UPDATE DELETE; do
    has=$(q "SELECT has_table_privilege('authenticated', 'public.$t', '$priv')::text;")
    [[ "$has" == "true" ]] || fail "authenticated must have $priv on $t"
  done
done
for priv in SELECT INSERT; do
  has=$(q "SELECT has_table_privilege('authenticated', 'public.activities', '$priv')::text;")
  [[ "$has" == "true" ]] || fail "authenticated must have $priv on activities"
done
for priv in UPDATE DELETE; do
  has=$(q "SELECT has_table_privilege('authenticated', 'public.activities', '$priv')::text;")
  [[ "$has" == "false" ]] || fail "authenticated must NOT have $priv on activities"
done
pass "authenticated grants: full DML on four tables; SELECT+INSERT only on activities"

log "=== C11: own-tenant CRUD for properties/clients/needs/follow_ups ==="
pa2=$(extract_uuid "$(as_auth "$ua" "INSERT INTO public.properties (organization_id, title, created_by, updated_by) VALUES ('$oa','Prop A2','$ua','$ua') RETURNING id;")")
[[ -n "$pa2" ]] || fail "CRUD re-seed property failed"
n=$(as_auth "$ua" "SELECT count(*) FROM public.properties WHERE id = '$pa2';" | grep -E '^[0-9]+$' | tail -1)
[[ "$n" == "1" ]] || fail "CRUD SELECT property failed"
n=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -At -c "
  DO \$\$
  DECLARE n int;
  BEGIN
    PERFORM set_config('role', 'authenticated', true);
    PERFORM auth.set_test_uid('$ua');
    UPDATE public.properties SET title = 'Updated', updated_by = '$ua' WHERE id = '$pa2';
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('role', 'none', true);
    RAISE NOTICE 'updated=%', n;
  END \$\$;
" 2>&1 | grep -oE 'updated=[0-9]+' | cut -d= -f2)
[[ "${n:-0}" == "1" ]] || fail "CRUD UPDATE property should affect 1"
n=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -At -c "
  DO \$\$
  DECLARE n int;
  BEGIN
    PERFORM set_config('role', 'authenticated', true);
    PERFORM auth.set_test_uid('$ua');
    DELETE FROM public.properties WHERE id = '$pa2';
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('role', 'none', true);
    RAISE NOTICE 'deleted=%', n;
  END \$\$;
" 2>&1 | grep -oE 'deleted=[0-9]+' | cut -d= -f2)
[[ "${n:-0}" == "1" ]] || fail "CRUD DELETE property should affect 1"

cc=$(extract_uuid "$(as_auth "$ua" "INSERT INTO public.clients (organization_id, name, created_by, updated_by) VALUES ('$oa','CRUD C','$ua','$ua') RETURNING id;")")
n=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -At -c "
  DO \$\$
  DECLARE n int;
  BEGIN
    PERFORM set_config('role', 'authenticated', true);
    PERFORM auth.set_test_uid('$ua');
    UPDATE public.clients SET name = 'CRUD C2', updated_by = '$ua' WHERE id = '$cc';
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('role', 'none', true);
    RAISE NOTICE 'updated=%', n;
  END \$\$;
" 2>&1 | grep -oE 'updated=[0-9]+' | cut -d= -f2)
[[ "${n:-0}" == "1" ]] || fail "CRUD UPDATE client should affect 1"
n=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -At -c "
  DO \$\$
  DECLARE n int;
  BEGIN
    PERFORM set_config('role', 'authenticated', true);
    PERFORM auth.set_test_uid('$ua');
    DELETE FROM public.clients WHERE id = '$cc';
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('role', 'none', true);
    RAISE NOTICE 'deleted=%', n;
  END \$\$;
" 2>&1 | grep -oE 'deleted=[0-9]+' | cut -d= -f2)
[[ "${n:-0}" == "1" ]] || fail "CRUD DELETE client should affect 1"

nc=$(extract_uuid "$(as_auth "$ua" "INSERT INTO public.needs (organization_id, client_id, created_by, updated_by) VALUES ('$oa','$ca','$ua','$ua') RETURNING id;")")
n=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -At -c "
  DO \$\$
  DECLARE n int;
  BEGIN
    PERFORM set_config('role', 'authenticated', true);
    PERFORM auth.set_test_uid('$ua');
    UPDATE public.needs SET notes = 'x', updated_by = '$ua' WHERE id = '$nc';
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('role', 'none', true);
    RAISE NOTICE 'updated=%', n;
  END \$\$;
" 2>&1 | grep -oE 'updated=[0-9]+' | cut -d= -f2)
[[ "${n:-0}" == "1" ]] || fail "CRUD UPDATE need should affect 1"
n=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -At -c "
  DO \$\$
  DECLARE n int;
  BEGIN
    PERFORM set_config('role', 'authenticated', true);
    PERFORM auth.set_test_uid('$ua');
    DELETE FROM public.needs WHERE id = '$nc';
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('role', 'none', true);
    RAISE NOTICE 'deleted=%', n;
  END \$\$;
" 2>&1 | grep -oE 'deleted=[0-9]+' | cut -d= -f2)
[[ "${n:-0}" == "1" ]] || fail "CRUD DELETE need should affect 1"

fc=$(extract_uuid "$(as_auth "$ua" "INSERT INTO public.follow_ups (organization_id, client_id, title, created_by, updated_by) VALUES ('$oa','$ca','CRUD FU','$ua','$ua') RETURNING id;")")
n=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -At -c "
  DO \$\$
  DECLARE n int;
  BEGIN
    PERFORM set_config('role', 'authenticated', true);
    PERFORM auth.set_test_uid('$ua');
    UPDATE public.follow_ups SET title = 'CRUD FU2', updated_by = '$ua' WHERE id = '$fc';
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('role', 'none', true);
    RAISE NOTICE 'updated=%', n;
  END \$\$;
" 2>&1 | grep -oE 'updated=[0-9]+' | cut -d= -f2)
[[ "${n:-0}" == "1" ]] || fail "CRUD UPDATE follow_up should affect 1"
n=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -At -c "
  DO \$\$
  DECLARE n int;
  BEGIN
    PERFORM set_config('role', 'authenticated', true);
    PERFORM auth.set_test_uid('$ua');
    DELETE FROM public.follow_ups WHERE id = '$fc';
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('role', 'none', true);
    RAISE NOTICE 'deleted=%', n;
  END \$\$;
" 2>&1 | grep -oE 'deleted=[0-9]+' | cut -d= -f2)
[[ "${n:-0}" == "1" ]] || fail "CRUD DELETE follow_up should affect 1"
pass "own-tenant INSERT/SELECT/UPDATE/DELETE for four tables"

log "ALL CLOUD DATA P0 CHECKS PASSED (C1–C11)"
