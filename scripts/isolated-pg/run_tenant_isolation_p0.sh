#!/usr/bin/env bash
# Isolated Postgres tenant-isolation matrix (T1–T6) against migrations 001–011.
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
WORK_DB="rahyar_tenant_p0_$$"

log() { printf '[tenant-p0] %s\n' "$*"; }
pass() { log "PASS: $*"; }
fail() { log "FAIL: $*"; exit 1; }

# Assert a psql command fails with one of the expected SQLSTATE codes.
# Prefer SQLSTATE from verbose ERROR lines; fall back to known codes in the text.
expect_fail() {
  local codes_re="$1"
  local desc="$2"
  local sql="$3"
  local err rc code
  set +e
  err=$(psql -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -c "$sql" 2>&1)
  rc=$?
  set -e
  [[ $rc -ne 0 ]] || fail "$desc: expected failure, command succeeded"
  code=$(printf '%s\n' "$err" | sed -nE 's/.*ERROR:[[:space:]]+([0-9A-Z]{5}):.*/\1/p' | head -1)
  if [[ -z "$code" ]]; then
    code=$(printf '%s\n' "$err" | grep -oE '(23503|23514|42501|42401|P0001)' | head -1 || true)
  fi
  if [[ -z "$code" ]] || ! [[ "$code" =~ ^($codes_re)$ ]]; then
    fail "$desc: expected SQLSTATE /$codes_re/, got '${code:-none}' :: $(printf '%s' "$err" | tr '\n' ' ' | cut -c1-240)"
  fi
}

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
  local out
  out=$(psql -q -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -At <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
DO \$\$
BEGIN
  PERFORM auth.set_test_uid('$uid');
END
\$\$;
$sql
COMMIT;
SQL
)
  printf '%s\n' "$out" | grep -Ev '^(BEGIN|COMMIT|SET|SELECT)$' | grep -v '^$' || true
}
as_auth_count() {
  local uid="$1"; local sql="$2"; local out
  out=$(as_auth "$uid" "$sql" 2>/dev/null | grep -E '^[0-9]+$' | tail -1)
  echo "${out:-0}"
}
visible_count() {
  local uid="$1"; local table="$2"
  as_auth_count "$uid" "SELECT count(*) FROM public.$table;"
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
psql_root -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$WORK_DB' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
psql_root -c "DROP DATABASE IF EXISTS $WORK_DB;" >/dev/null 2>&1 || true
psql_root -c "CREATE DATABASE $WORK_DB;"

log "Applying stubs + timestamp migrations including cloud data foundation (009+010+011)"
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
  20261112121112_cloud_business_data_foundation_009.sql \
  20261112140000_cloud_business_foreign_key_indexes_010.sql \
  20261113212202_role_based_business_delete_permissions.sql
do
  log "  -> $f"
  psql_db -f "$MIGRATIONS_DIR/$f" >/dev/null
done

log "=== Migration 008 + 009 + 011 verification ==="
priv_fn=$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'private' AND p.proname = 'user_organization_ids';")
[[ "$priv_fn" == "1" ]] || fail "private.user_organization_ids() missing after Migration 008"
pass "private.user_organization_ids() present"
del_fn=$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'private' AND p.proname = 'user_can_delete_business_data';")
[[ "$del_fn" == "1" ]] || fail "private.user_can_delete_business_data missing after Migration 011"
for t in properties clients needs follow_ups; do
  restr=$(q "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='$t' AND policyname='${t}_delete_role_guard' AND permissive='RESTRICTIVE' AND cmd='DELETE';")
  [[ "$restr" == "1" ]] || fail "RESTRICTIVE delete role-guard missing on $t"
done
pass "private.user_can_delete_business_data + restrictive role-guards present"
for t in properties clients needs follow_ups activities; do
  c=$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='$t';")
  [[ "$c" == "1" ]] || fail "table $t missing after 009"
done
pass "five business tables present after 009"

log "Seeding two organizations and business rows (with created_by/updated_by)"
owner_a=$(extract_uuid "$(q "INSERT INTO auth.users (email, raw_user_meta_data) VALUES ('owner_a@test.local', '{\"full_name\":\"Owner A\"}'::jsonb) RETURNING id;")")
owner_b=$(extract_uuid "$(q "INSERT INTO auth.users (email, raw_user_meta_data) VALUES ('owner_b@test.local', '{\"full_name\":\"Owner B\"}'::jsonb) RETURNING id;")")
[[ -n "$owner_a" && -n "$owner_b" && "$owner_a" != "$owner_b" ]] || fail "seed users failed: a=$owner_a b=$owner_b"
q "INSERT INTO public.profiles (id, full_name) VALUES ('$owner_a', 'Owner A') ON CONFLICT (id) DO NOTHING;" >/dev/null
q "INSERT INTO public.profiles (id, full_name) VALUES ('$owner_b', 'Owner B') ON CONFLICT (id) DO NOTHING;" >/dev/null
org_a=$(extract_uuid "$(q "INSERT INTO public.organizations (name, slug) VALUES ('Org A', 'org-a-$$') RETURNING id;")")
org_b=$(extract_uuid "$(q "INSERT INTO public.organizations (name, slug) VALUES ('Org B', 'org-b-$$') RETURNING id;")")
[[ -n "$org_a" && -n "$org_b" ]] || fail "org seed failed"
q "INSERT INTO public.organization_members (organization_id, user_id, role, status, joined_at)
   VALUES
     ('$org_a','$owner_a','owner','active',now()),
     ('$org_b','$owner_b','owner','active',now());" >/dev/null

client_a=$(extract_uuid "$(as_auth "$owner_a" "INSERT INTO public.clients (organization_id, name, created_by, updated_by) VALUES ('$org_a','Client A','$owner_a','$owner_a') RETURNING id;")")
client_b=$(extract_uuid "$(as_auth "$owner_b" "INSERT INTO public.clients (organization_id, name, created_by, updated_by) VALUES ('$org_b','Client B','$owner_b','$owner_b') RETURNING id;")")
[[ -n "$client_a" && -n "$client_b" ]] || fail "client seed failed"
prop_a=$(extract_uuid "$(as_auth "$owner_a" "INSERT INTO public.properties (organization_id, title, created_by, updated_by) VALUES ('$org_a','Prop A','$owner_a','$owner_a') RETURNING id;")")
prop_b=$(extract_uuid "$(as_auth "$owner_b" "INSERT INTO public.properties (organization_id, title, created_by, updated_by) VALUES ('$org_b','Prop B','$owner_b','$owner_b') RETURNING id;")")
[[ -n "$prop_a" && -n "$prop_b" ]] || fail "property seed failed"
need_a=$(extract_uuid "$(as_auth "$owner_a" "INSERT INTO public.needs (organization_id, client_id, created_by, updated_by) VALUES ('$org_a','$client_a','$owner_a','$owner_a') RETURNING id;")")
need_b=$(extract_uuid "$(as_auth "$owner_b" "INSERT INTO public.needs (organization_id, client_id, created_by, updated_by) VALUES ('$org_b','$client_b','$owner_b','$owner_b') RETURNING id;")")
[[ -n "$need_a" && -n "$need_b" ]] || fail "need seed failed"
fu_a=$(extract_uuid "$(as_auth "$owner_a" "INSERT INTO public.follow_ups (organization_id, client_id, property_id, title, created_by, updated_by) VALUES ('$org_a','$client_a','$prop_a','FU A','$owner_a','$owner_a') RETURNING id;")")
fu_b=$(extract_uuid "$(as_auth "$owner_b" "INSERT INTO public.follow_ups (organization_id, client_id, property_id, title, created_by, updated_by) VALUES ('$org_b','$client_b','$prop_b','FU B','$owner_b','$owner_b') RETURNING id;")")
[[ -n "$fu_a" && -n "$fu_b" ]] || fail "follow_up seed failed"
act_a=$(extract_uuid "$(as_auth "$owner_a" "INSERT INTO public.activities (organization_id, type, text, created_by) VALUES ('$org_a','client','seed A','$owner_a') RETURNING id;")")
act_b=$(extract_uuid "$(as_auth "$owner_b" "INSERT INTO public.activities (organization_id, type, text, created_by) VALUES ('$org_b','client','seed B','$owner_b') RETURNING id;")")
[[ -n "$act_a" && -n "$act_b" ]] || fail "activity seed failed"
pass "seeded TenantA/TenantB rows"

log "=== T1: Cross-tenant SELECT ==="
for t in properties clients needs follow_ups activities; do
  ca=$(visible_count "$owner_a" "$t")
  cb=$(visible_count "$owner_b" "$t")
  [[ "$ca" == "1" ]] || fail "T1 Owner A should see 1 row in $t, got $ca"
  [[ "$cb" == "1" ]] || fail "T1 Owner B should see 1 row in $t, got $cb"
  bid=$(q "SELECT id::text FROM public.$t WHERE organization_id = '$org_b' LIMIT 1;")
  seen=$(as_auth_count "$owner_a" "SELECT count(*) FROM public.$t WHERE id = '$bid';")
  [[ "$seen" == "0" ]] || fail "T1 Owner A must not see Org B row in $t"
done
pass "T1: each owner sees only own-tenant rows (5 tables)"

log "=== T2: Cross-tenant INSERT rejected by RLS ==="
expect_fail '42501' "T2 property INSERT into foreign org (RLS)" "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$owner_a');
  INSERT INTO public.properties (organization_id, title, created_by, updated_by)
  VALUES ('$org_b','X','$owner_a','$owner_a');
  COMMIT;"
expect_fail '42501' "T2 client INSERT into foreign org (RLS)" "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$owner_a');
  INSERT INTO public.clients (organization_id, name, created_by, updated_by)
  VALUES ('$org_b','X','$owner_a','$owner_a');
  COMMIT;"
expect_fail '42501' "T2 activity INSERT into foreign org (RLS)" "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$owner_a');
  INSERT INTO public.activities (organization_id, type, text, created_by)
  VALUES ('$org_b','client','x','$owner_a');
  COMMIT;"
expect_fail '23503' "T2 cross-org need foreign client (composite FK)" "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$owner_a');
  INSERT INTO public.needs (organization_id, client_id, created_by, updated_by)
  VALUES ('$org_a','$client_b','$owner_a','$owner_a');
  COMMIT;"
expect_fail '23514' "T2 cross-org follow_up foreign property (same-org trigger)" "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$owner_a');
  INSERT INTO public.follow_ups (organization_id, client_id, property_id, title, created_by, updated_by)
  VALUES ('$org_a','$client_a','$prop_b','X','$owner_a','$owner_a');
  COMMIT;"
pass "T2: cross-tenant INSERT rejected (RLS 42501 + FK 23503 + trigger 23514)"

log "=== T3: Cross-tenant UPDATE blocked; org_id immutable ==="
for t in properties clients needs follow_ups; do
  bid=$(q "SELECT id::text FROM public.$t WHERE organization_id = '$org_b' LIMIT 1;")
  aid=$(q "SELECT id::text FROM public.$t WHERE organization_id = '$org_a' LIMIT 1;")
  n=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -At -c "
    DO \$\$
    DECLARE n int;
    BEGIN
      PERFORM set_config('role', 'authenticated', true);
      PERFORM auth.set_test_uid('$owner_a');
      UPDATE public.$t SET updated_by = '$owner_a' WHERE id = '$bid';
      GET DIAGNOSTICS n = ROW_COUNT;
      PERFORM set_config('role', 'none', true);
      RAISE NOTICE 'affected=%', n;
    END \$\$;
  " 2>&1 | grep -oE 'affected=[0-9]+' | cut -d= -f2)
  [[ "${n:-x}" == "0" ]] || fail "T3 UPDATE foreign row in $t should affect 0 rows, got ${n:-none}"
  expect_fail '23514' "T3 org_id move on $t blocked by trigger" "
    BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$owner_a');
    UPDATE public.$t SET organization_id = '$org_b', updated_by = '$owner_a' WHERE id = '$aid';
    COMMIT;"
  final_org=$(q "SELECT organization_id::text FROM public.$t WHERE id = '$aid';")
  [[ "$final_org" == "$org_a" ]] || fail "T3 org_id move must not succeed for $t (final=$final_org)"
done
expect_fail '42501' "T3 activity UPDATE denied (no privilege)" "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$owner_a');
  UPDATE public.activities SET text = 'x' WHERE id = '$act_a';
  COMMIT;"
pass "T3: cross-tenant UPDATE blocked; org_id immutable (23514); activities no UPDATE (42501)"

log "=== T4: Cross-tenant DELETE blocked ==="
for t in properties clients needs follow_ups; do
  bid=$(q "SELECT id::text FROM public.$t WHERE organization_id = '$org_b' LIMIT 1;")
  n=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -At -c "
    DO \$\$
    DECLARE n int;
    BEGIN
      PERFORM set_config('role', 'authenticated', true);
      PERFORM auth.set_test_uid('$owner_a');
      DELETE FROM public.$t WHERE id = '$bid';
      GET DIAGNOSTICS n = ROW_COUNT;
      PERFORM set_config('role', 'none', true);
      RAISE NOTICE 'affected=%', n;
    END \$\$;
  " 2>&1 | grep -oE 'affected=[0-9]+' | cut -d= -f2)
  [[ "${n:-x}" == "0" ]] || fail "T4 DELETE foreign row in $t should affect 0, got ${n:-none}"
done
expect_fail '42501' "T4 activity DELETE denied (no privilege)" "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$owner_a');
  DELETE FROM public.activities WHERE id = '$act_a';
  COMMIT;"
still=$(q "SELECT count(*) FROM public.activities WHERE id = '$act_a';")
[[ "$still" == "1" ]] || fail "T4 activity must remain"
pass "T4: cross-tenant DELETE blocked; activities no DELETE (42501)"

log "=== T5: Own-tenant DML (activities append-only) ==="
new_prop=$(extract_uuid "$(as_auth "$owner_a" "INSERT INTO public.properties (organization_id, title, created_by, updated_by) VALUES ('$org_a','New Prop','$owner_a','$owner_a') RETURNING id;")")
[[ -n "$new_prop" ]] || fail "T5 own property INSERT failed"
n=$(as_auth "$owner_a" "UPDATE public.properties SET title = 'New Prop 2', updated_by = '$owner_a' WHERE id = '$new_prop' RETURNING id;")
[[ -n "$n" ]] || fail "T5 own property UPDATE failed"
n=$(as_auth "$owner_a" "DELETE FROM public.properties WHERE id = '$new_prop' RETURNING id;")
[[ -n "$n" ]] || fail "T5 own property DELETE failed"
new_act=$(extract_uuid "$(as_auth "$owner_a" "INSERT INTO public.activities (organization_id, type, text, created_by) VALUES ('$org_a','client','new act','$owner_a') RETURNING id;")")
[[ -n "$new_act" ]] || fail "T5 activity INSERT failed"
seen=$(as_auth_count "$owner_a" "SELECT count(*) FROM public.activities WHERE id = '$new_act';")
[[ "$seen" == "1" ]] || fail "T5 activity SELECT failed"
expect_fail '42501' "T5 activity UPDATE denied (no privilege)" "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$owner_a');
  UPDATE public.activities SET text = 'mut' WHERE id = '$new_act';
  COMMIT;"
expect_fail '42501' "T5 activity DELETE denied (no privilege)" "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$owner_a');
  DELETE FROM public.activities WHERE id = '$new_act';
  COMMIT;"
still=$(q "SELECT count(*) FROM public.activities WHERE id = '$new_act';")
[[ "$still" == "1" ]] || fail "T5 activity must remain after failed DELETE"
expect_fail '23514' "T5 created_by change blocked by trigger" "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$owner_a');
  UPDATE public.clients SET created_by = '$owner_b', updated_by = '$owner_a' WHERE id = '$client_a';
  COMMIT;"
pass "T5: own-tenant CRUD (activities append-only 42501); created_by immutable (23514)"

log "=== T6: Organization and membership write protection ==="
expect_fail '42501' "T6 direct organization INSERT (RLS/privilege)" "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$owner_a');
  INSERT INTO public.organizations (name, slug) VALUES ('Forged','forged');
  COMMIT;"
pass "T6: direct organization INSERT blocked (42501)"

expect_fail '42501' "T6 forged membership INSERT (RLS/privilege)" "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$owner_a');
  INSERT INTO public.organization_members (organization_id, user_id, role, status) VALUES ('$org_b','$owner_a','admin','active');
  COMMIT;"
pass "T6: forged membership INSERT blocked (42501)"

set +e
err=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -c "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$owner_a');
  UPDATE public.organization_members SET role = 'admin' WHERE user_id = '$owner_b';
  COMMIT;" 2>&1)
rc=$?
set -e
role_b=$(q "SELECT role::text FROM public.organization_members WHERE user_id = '$owner_b';")
[[ "$role_b" == "owner" ]] || fail "T6 Owner B role must remain owner, got $role_b"
pass "T6: cannot change another member's role"

set +e
err=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -c "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$owner_a');
  DELETE FROM public.organization_members WHERE user_id = '$owner_b';
  COMMIT;" 2>&1)
rc=$?
set -e
still=$(q "SELECT count(*) FROM public.organization_members WHERE user_id = '$owner_b' AND status = 'active';")
[[ "$still" == "1" ]] || fail "T6 Owner B membership must remain"
pass "T6: cannot delete another member's membership"

org_vis=$(as_auth_count "$owner_a" "SELECT count(*) FROM public.organizations;")
[[ "$org_vis" == "1" ]] || fail "T6 Owner A should see 1 organization, got $org_vis"
pass "T6: organization visibility scoped to membership"

log "=============================================="
log "ALL TENANT ISOLATION TESTS PASSED"
log "  - T1 SELECT isolation: PASS"
log "  - T2 INSERT rejection (RLS + composite FK): PASS"
log "  - T3 UPDATE blocked / org_id immutable / activities no UPDATE: PASS"
log "  - T4 DELETE blocked / activities no DELETE: PASS"
log "  - T5 own-tenant CRUD + activities append-only + created_by immutable: PASS"
log "  - T6 org/membership writes: PASS"
log "  - Migration 008 private helper + 009 tables + 010 indexes + 011 role-delete: PASS"
log "Temporary DB $WORK_DB dropped on exit."
log "=============================================="
