#!/usr/bin/env bash
# Isolated Postgres P0 for cloud business data foundation (migration 009).
# Temporary DB only — never Staging/Production.
# C1–C9 proven green. Dual-active dual-member deferred (idx_org_members_one_active_per_user Phase 1).
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

# Assert a psql command fails with one of the expected SQLSTATE codes.
# Prefer SQLSTATE from verbose ERROR lines; fall back to known codes / message patterns.
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
  # Message-pattern fallback (covers builds where SQLSTATE is not echoed)
  if [[ -z "$code" ]] || ! [[ "$code" =~ ^($codes_re)$ ]]; then
    if [[ "$codes_re" == *42501* ]] && printf '%s\n' "$err" | grep -qiE 'permission denied|row-level security|violates row-level|insufficient_privilege'; then
      code=42501
    elif [[ "$codes_re" == *23503* ]] && printf '%s\n' "$err" | grep -qiE 'foreign key|violates foreign key'; then
      code=23503
    elif [[ "$codes_re" == *23514* ]] && printf '%s\n' "$err" | grep -qiE 'check constraint|organization_id cannot be changed|created_by cannot be changed|same organization|must belong to the same organization'; then
      code=23514
    fi
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

log "Applying stubs + 11 migrations (through 011 role-based business delete)"
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

log "=== Schema presence ==="
for t in properties clients needs follow_ups activities; do
  c=$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='$t';")
  [[ "$c" == "1" ]] || fail "table $t missing"
done
pass "five business tables exist"

log "=== Seed two orgs + members (single active membership — Phase 1) ==="
ua=$(extract_uuid "$(q "INSERT INTO auth.users (email) VALUES ('a@test.local') RETURNING id;")")
ub=$(extract_uuid "$(q "INSERT INTO auth.users (email) VALUES ('b@test.local') RETURNING id;")")
uc=$(extract_uuid "$(q "INSERT INTO auth.users (email) VALUES ('nomember@test.local') RETURNING id;")")
q "INSERT INTO public.profiles (id, full_name) VALUES ('$ua','A'),('$ub','B'),('$uc','C') ON CONFLICT DO NOTHING;" >/dev/null
oa=$(extract_uuid "$(q "INSERT INTO public.organizations (name, slug) VALUES ('OrgA','org-a-$$') RETURNING id;")")
ob=$(extract_uuid "$(q "INSERT INTO public.organizations (name, slug) VALUES ('OrgB','org-b-$$') RETURNING id;")")
q "INSERT INTO public.organization_members (organization_id, user_id, role, status, joined_at)
   VALUES
     ('$oa','$ua','owner','active',now()),
     ('$ob','$ub','owner','active',now());" >/dev/null

ca=$(extract_uuid "$(as_auth "$ua" "INSERT INTO public.clients (organization_id, name, created_by, updated_by) VALUES ('$oa','Client A','$ua','$ua') RETURNING id;")")
cb=$(extract_uuid "$(as_auth "$ub" "INSERT INTO public.clients (organization_id, name, created_by, updated_by) VALUES ('$ob','Client B','$ub','$ub') RETURNING id;")")
pa=$(extract_uuid "$(as_auth "$ua" "INSERT INTO public.properties (organization_id, title, created_by, updated_by) VALUES ('$oa','Prop A','$ua','$ua') RETURNING id;")")
pb=$(extract_uuid "$(as_auth "$ub" "INSERT INTO public.properties (organization_id, title, created_by, updated_by) VALUES ('$ob','Prop B','$ub','$ub') RETURNING id;")")
na=$(extract_uuid "$(as_auth "$ua" "INSERT INTO public.needs (organization_id, client_id, location, notes, created_by, updated_by) VALUES ('$oa','$ca','loc','Need A','$ua','$ua') RETURNING id;")")
nb=$(extract_uuid "$(as_auth "$ub" "INSERT INTO public.needs (organization_id, client_id, location, notes, created_by, updated_by) VALUES ('$ob','$cb','loc','Need B','$ub','$ub') RETURNING id;")")
fid=$(extract_uuid "$(as_auth "$ua" "INSERT INTO public.follow_ups (organization_id, client_id, property_id, title, due_date, created_by, updated_by) VALUES ('$oa','$ca','$pa','FU A', CURRENT_DATE, '$ua','$ua') RETURNING id;")")
[[ -n "$ca" && -n "$cb" && -n "$pa" && -n "$pb" && -n "$na" && -n "$nb" && -n "$fid" ]] || fail "seed rows failed"
pass "seeded OrgA/OrgB business rows"

log "=== C1: anon has no privileges ==="
for t in properties clients needs follow_ups activities; do
  expect_fail '42501' "anon SELECT on $t" "SET ROLE anon; SELECT count(*) FROM public.$t;"
done
pass "anon blocked on business tables"

log "=== C2: non-member sees zero ==="
n=$(as_auth "$uc" "SELECT count(*) FROM public.clients;")
[[ "$n" == "0" ]] || fail "nomember should see 0 clients, got $n"
pass "nomember sees zero clients"

log "=== C3: tenant isolation SELECT ==="
n=$(as_auth "$ua" "SELECT count(*) FROM public.clients WHERE organization_id = '$ob';")
[[ "$n" == "0" ]] || fail "Owner A must not see OrgB clients"
n=$(as_auth "$ub" "SELECT count(*) FROM public.clients WHERE organization_id = '$oa';")
[[ "$n" == "0" ]] || fail "Owner B must not see OrgA clients"
pass "cross-tenant SELECT isolation"

log "=== C4: composite FK blocks cross-org need ==="
expect_fail '23503' "cross-org need insert (composite FK)" "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$ua');
  INSERT INTO public.needs (organization_id, client_id, created_by, updated_by) VALUES ('$oa','$cb','$ua','$ua');
  COMMIT;"
pass "composite FK blocks cross-org need (SQLSTATE 23503)"

log "=== C5: organization_id immutable ==="
expect_fail '23514' "organization_id change blocked by trigger" "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$ua');
  UPDATE public.clients SET organization_id = '$ob', updated_by = '$ua' WHERE id = '$ca';
  COMMIT;"
final_org=$(q "SELECT organization_id::text FROM public.clients WHERE id = '$ca';")
[[ "$final_org" == "$oa" ]] || fail "organization_id must remain $oa, got $final_org"
pass "organization_id immutable on clients (SQLSTATE 23514)"

log "=== C6: activities append-only ==="
aid=$(extract_uuid "$(as_auth "$ua" "INSERT INTO public.activities (organization_id, type, text, created_by) VALUES ('$oa','client','hello','$ua') RETURNING id;")")
[[ -n "$aid" ]] || fail "activity insert failed"
expect_fail '42501' "activity UPDATE denied (no privilege)" "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$ua');
  UPDATE public.activities SET text = 'x' WHERE id = '$aid';
  COMMIT;"
expect_fail '42501' "activity DELETE denied (no privilege)" "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$ua');
  DELETE FROM public.activities WHERE id = '$aid';
  COMMIT;"
still=$(q "SELECT count(*) FROM public.activities WHERE id = '$aid';")
[[ "$still" == "1" ]] || fail "activity row must remain after failed DELETE"
pass "activities are append-only for authenticated (SQLSTATE 42501)"

log "=== C7: follow_up cross-org property rejected (RLS-hidden property -> 23503) ==="
# pb must exist and belong to OrgB (privileged verification)
pb_org=$(q "SELECT organization_id::text FROM public.properties WHERE id = '$pb';")
[[ "$pb_org" == "$ob" ]] || fail "C7 precondition: pb must belong to OrgB (got org=$pb_org)"
pb_exists=$(q "SELECT count(*) FROM public.properties WHERE id = '$pb';")
[[ "$pb_exists" == "1" ]] || fail "C7 precondition: pb must exist"
# Owner A cannot see pb under RLS
seen_pb=$(as_auth "$ua" "SELECT count(*) FROM public.properties WHERE id = '$pb';")
[[ "$seen_pb" == "0" ]] || fail "C7 precondition: Owner A must not see pb under RLS"
# SECURITY INVOKER trigger SELECT is subject to RLS: property invisible -> v_prop_org NULL -> 23503
expect_fail '23503' "C7 cross-org property on follow_up (RLS hides property; trigger fail-closed 23503)" "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$ua');
  INSERT INTO public.follow_ups (organization_id, client_id, property_id, title, due_date, created_by, updated_by)
  VALUES ('$oa','$ca','$pb','cross', CURRENT_DATE, '$ua','$ua');
  COMMIT;"
pass "C7: follow_up cross-org property rejected (SQLSTATE 23503 via RLS-hidden property)"

log "=== C8: created_by immutable after insert ==="
expect_fail '23514' "created_by change blocked by trigger" "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$ua');
  UPDATE public.clients SET created_by = '$ub', updated_by = '$ua' WHERE id = '$ca';
  COMMIT;"
final_cb=$(q "SELECT created_by::text FROM public.clients WHERE id = '$ca';")
[[ "$final_cb" == "$ua" ]] || fail "created_by changed to $final_cb"
pass "created_by immutable on clients (SQLSTATE 23514)"

log "=== C9: property DELETE sets follow_ups.property_id NULL; org_id unchanged ==="
cur=$(q "SELECT property_id::text FROM public.follow_ups WHERE id = '$fid';")
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
fu_prop=$(q "SELECT property_id::text FROM public.follow_ups WHERE id = '$fid';")
[[ "$fu_prop" == "" ]] || fail "follow_ups.property_id should be NULL after property delete, got $fu_prop"
fu_org=$(q "SELECT organization_id::text FROM public.follow_ups WHERE id = '$fid';")
[[ "$fu_org" == "$oa" ]] || fail "follow_ups.organization_id must stay $oa, got $fu_org"
pass "property ON DELETE SET NULL; organization_id unchanged"

log "=== R1: Migration 011 helper + restrictive policy + privilege catalog ==="
helper=$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'private' AND p.proname = 'user_can_delete_business_data';")
[[ "$helper" == "1" ]] || fail "private.user_can_delete_business_data missing"
sec=$(q "SELECT CASE WHEN p.prosecdef THEN 1 ELSE 0 END FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='private' AND p.proname='user_can_delete_business_data';")
[[ "$sec" == "1" ]] || fail "helper must be SECURITY DEFINER"
vol=$(q "SELECT p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='private' AND p.proname='user_can_delete_business_data';")
[[ "$vol" == "s" ]] || fail "helper must be STABLE (provolatile=s), got $vol"
sp_count=$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, LATERAL pg_options_to_table(p.proconfig) opt WHERE n.nspname='private' AND p.proname='user_can_delete_business_data' AND opt.option_name = 'search_path';")
[[ "$sp_count" == "1" ]] || fail "helper must have a search_path function setting (got count=$sp_count)"
sp_val=$(q "SELECT opt.option_value FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, LATERAL pg_options_to_table(p.proconfig) opt WHERE n.nspname='private' AND p.proname='user_can_delete_business_data' AND opt.option_name = 'search_path';")
[[ "$sp_val" == '""' ]] || fail "helper search_path is not encoded as an empty value in pg_proc catalog (got '$sp_val')"
pub_exec=$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a WHERE n.nspname='private' AND p.proname='user_can_delete_business_data' AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';")
[[ "$pub_exec" == "0" ]] || fail "PUBLIC must not have EXECUTE on helper (acl count=$pub_exec)"
anon_exec=$(q "SELECT has_function_privilege('anon', 'private.user_can_delete_business_data(uuid)', 'EXECUTE')::text;")
[[ "$anon_exec" == "f" || "$anon_exec" == "false" ]] || fail "anon must not EXECUTE helper"
auth_exec=$(q "SELECT has_function_privilege('authenticated', 'private.user_can_delete_business_data(uuid)', 'EXECUTE')::text;")
[[ "$auth_exec" == "t" || "$auth_exec" == "true" ]] || fail "authenticated must EXECUTE helper"
for t in properties clients needs follow_ups; do
  restr=$(q "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='$t' AND policyname='${t}_delete_role_guard' AND cmd='DELETE' AND permissive='RESTRICTIVE';")
  [[ "$restr" == "1" ]] || fail "missing RESTRICTIVE delete role-guard on $t (got $restr)"
  polp=$(q "SELECT count(*) FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='$t' AND pol.polname='${t}_delete_role_guard' AND pol.polcmd='d' AND pol.polpermissive = false;")
  [[ "$polp" == "1" ]] || fail "catalog polpermissive=false missing for ${t}_delete_role_guard"
  perm=$(q "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='$t' AND policyname='${t}_delete_member' AND cmd='DELETE' AND permissive='PERMISSIVE';")
  [[ "$perm" == "1" ]] || fail "missing permissive tenant delete policy on $t"
done
legacy=$(q "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'Tenant isolation for %';")
[[ "$legacy" == "0" ]] || fail "legacy Tenant isolation policies still present: $legacy"
act_del_pol=$(q "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='activities' AND cmd='DELETE';")
[[ "$act_del_pol" == "0" ]] || fail "activities must have no DELETE policy"
act_upd_pol=$(q "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='activities' AND cmd='UPDATE';")
[[ "$act_upd_pol" == "0" ]] || fail "activities must have no UPDATE policy"
act_sel=$(q "SELECT has_table_privilege('authenticated', 'public.activities', 'SELECT')::text;")
act_ins=$(q "SELECT has_table_privilege('authenticated', 'public.activities', 'INSERT')::text;")
act_upd=$(q "SELECT has_table_privilege('authenticated', 'public.activities', 'UPDATE')::text;")
act_del=$(q "SELECT has_table_privilege('authenticated', 'public.activities', 'DELETE')::text;")
[[ "$act_sel" == "t" || "$act_sel" == "true" ]] || fail "authenticated must have SELECT on activities"
[[ "$act_ins" == "t" || "$act_ins" == "true" ]] || fail "authenticated must have INSERT on activities"
[[ "$act_upd" == "f" || "$act_upd" == "false" ]] || fail "authenticated must NOT have UPDATE on activities"
[[ "$act_del" == "f" || "$act_del" == "false" ]] || fail "authenticated must NOT have DELETE on activities"
pass "011 helper + restrictive role-guards + activities privilege catalog"

log "=== R2: Seed owner/admin/agent in OrgA + agent-created business rows ==="
u_admin=$(extract_uuid "$(q "INSERT INTO auth.users (email) VALUES ('admin-a@test.local') RETURNING id;")")
u_agent=$(extract_uuid "$(q "INSERT INTO auth.users (email) VALUES ('agent-a@test.local') RETURNING id;")")
q "INSERT INTO public.profiles (id, full_name) VALUES ('$u_admin','Admin A'),('$u_agent','Agent A') ON CONFLICT DO NOTHING;" >/dev/null
q "INSERT INTO public.organization_members (organization_id, user_id, role, status, joined_at)
   VALUES
     ('$oa','$u_admin','admin','active',now()),
     ('$oa','$u_agent','agent','active',now());" >/dev/null

agent_client=$(extract_uuid "$(as_auth "$u_agent" "INSERT INTO public.clients (organization_id, name, created_by, updated_by) VALUES ('$oa','Agent Client','$u_agent','$u_agent') RETURNING id;")")
agent_prop=$(extract_uuid "$(as_auth "$u_agent" "INSERT INTO public.properties (organization_id, title, created_by, updated_by) VALUES ('$oa','Agent Prop','$u_agent','$u_agent') RETURNING id;")")
agent_need=$(extract_uuid "$(as_auth "$u_agent" "INSERT INTO public.needs (organization_id, client_id, location, notes, created_by, updated_by) VALUES ('$oa','$agent_client','loc','Agent Need','$u_agent','$u_agent') RETURNING id;")")
agent_fu=$(extract_uuid "$(as_auth "$u_agent" "INSERT INTO public.follow_ups (organization_id, client_id, property_id, title, due_date, created_by, updated_by) VALUES ('$oa','$agent_client','$agent_prop','Agent FU', CURRENT_DATE, '$u_agent','$u_agent') RETURNING id;")")
[[ -n "$agent_client" && -n "$agent_prop" && -n "$agent_need" && -n "$agent_fu" ]] || fail "agent seed rows failed"
agent_act=$(extract_uuid "$(as_auth "$u_agent" "INSERT INTO public.activities (organization_id, type, text, created_by) VALUES ('$oa','client','seed activity','$u_agent') RETURNING id;")")
[[ -n "$agent_act" ]] || fail "agent activity seed failed"
owner_prop_for_agent=$(extract_uuid "$(as_auth "$ua" "INSERT INTO public.properties (organization_id, title, created_by, updated_by) VALUES ('$oa','Owner Prop For Agent Deny','$ua','$ua') RETURNING id;")")
[[ -n "$owner_prop_for_agent" ]] || fail "owner property seed for agent-deny failed"
admin_act=$(extract_uuid "$(as_auth "$u_admin" "INSERT INTO public.activities (organization_id, type, text, created_by) VALUES ('$oa','client','admin activity','$u_admin') RETURNING id;")")
[[ -n "$admin_act" ]] || fail "admin activity INSERT must succeed"
owner_act2=$(extract_uuid "$(as_auth "$ua" "INSERT INTO public.activities (organization_id, type, text, created_by) VALUES ('$oa','client','owner activity','$ua') RETURNING id;")")
[[ -n "$owner_act2" ]] || fail "owner activity INSERT must succeed"
pass "seeded admin/agent + agent-created rows + owner property; owner/admin/agent can INSERT activities"

delete_count() {
  local uid="$1"; local sql="$2"
  local out num
  out=$(psql -q -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -At <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
DO \$\$
BEGIN
  PERFORM auth.set_test_uid('$uid');
END
\$\$;
WITH d AS ($sql)
SELECT count(*)::text FROM d;
COMMIT;
SQL
)
  num=$(printf '%s\n' "$out" | grep -E '^[0-9]+$' | tail -1)
  if [[ -z "$num" ]]; then
    fail "delete_count: expected numeric count, got: $(printf '%s' "$out" | tr '\n' ' ')"
  fi
  printf '%s\n' "$num"
}

log "=== R3: Agent MUST NOT delete agent-created or owner-created business rows ==="
for pair in \
  "properties|$agent_prop" \
  "properties|$owner_prop_for_agent" \
  "clients|$agent_client" \
  "needs|$agent_need" \
  "follow_ups|$agent_fu"
do
  tbl="${pair%%|*}"; id="${pair##*|}"
  n=$(delete_count "$u_agent" "DELETE FROM public.$tbl WHERE id = '$id' RETURNING id")
  [[ "$n" == "0" ]] || fail "agent DELETE on $tbl should affect 0 rows, got $n"
  left=$(q "SELECT count(*) FROM public.$tbl WHERE id = '$id';")
  [[ "$left" == "1" ]] || fail "agent DELETE must leave $tbl row intact"
done
pass "agent cannot delete properties/clients/needs/follow_ups (0 rows affected)"

log "=== R4: Admin can delete agent-created rows (child rows before client) ==="
n=$(delete_count "$u_admin" "DELETE FROM public.follow_ups WHERE id = '$agent_fu' RETURNING id")
[[ "$n" == "1" ]] || fail "admin DELETE follow_ups expected 1, got $n"
n=$(delete_count "$u_admin" "DELETE FROM public.needs WHERE id = '$agent_need' RETURNING id")
[[ "$n" == "1" ]] || fail "admin DELETE needs expected 1, got $n"
n=$(delete_count "$u_admin" "DELETE FROM public.properties WHERE id = '$agent_prop' RETURNING id")
[[ "$n" == "1" ]] || fail "admin DELETE properties expected 1, got $n"
n=$(delete_count "$u_admin" "DELETE FROM public.clients WHERE id = '$agent_client' RETURNING id")
[[ "$n" == "1" ]] || fail "admin DELETE clients expected 1, got $n"
for pair in \
  "properties|$agent_prop" \
  "clients|$agent_client" \
  "needs|$agent_need" \
  "follow_ups|$agent_fu"
do
  tbl="${pair%%|*}"; id="${pair##*|}"
  left=$(q "SELECT count(*) FROM public.$tbl WHERE id = '$id';")
  [[ "$left" == "0" ]] || fail "admin DELETE should remove $tbl row"
done
pass "admin deletes all four agent-created business rows"

log "=== R5: Owner can delete own-organization business row ==="
owner_client=$(extract_uuid "$(as_auth "$ua" "INSERT INTO public.clients (organization_id, name, created_by, updated_by) VALUES ('$oa','Owner Client','$ua','$ua') RETURNING id;")")
[[ -n "$owner_client" ]] || fail "owner client seed failed"
n=$(delete_count "$ua" "DELETE FROM public.clients WHERE id = '$owner_client' RETURNING id")
[[ "$n" == "1" ]] || fail "owner DELETE client expected 1, got $n"
left=$(q "SELECT count(*) FROM public.clients WHERE id = '$owner_client';")
[[ "$left" == "0" ]] || fail "owner DELETE should remove client"
pass "owner can delete own-org business row"

log "=== R6: Tenant isolation — OrgA admin cannot delete OrgB client ==="
n=$(delete_count "$u_admin" "DELETE FROM public.clients WHERE id = '$cb' RETURNING id")
[[ "$n" == "0" ]] || fail "cross-tenant admin DELETE should affect 0, got $n"
left=$(q "SELECT count(*) FROM public.clients WHERE id = '$cb';")
[[ "$left" == "1" ]] || fail "OrgB client must remain after OrgA admin DELETE attempt"
pass "tenant isolation: OrgA admin cannot delete OrgB row"

log "=== R7: Activities remain append-only for owner, admin, and agent (permission denied) ==="
for uid in "$ua" "$u_admin" "$u_agent"; do
  expect_fail '42501' "activities DELETE by $uid" "
    BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$uid');
    DELETE FROM public.activities WHERE id = '$agent_act';
    COMMIT;"
  expect_fail '42501' "activities UPDATE by $uid" "
    BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$uid');
    UPDATE public.activities SET text = 'hacked' WHERE id = '$agent_act';
    COMMIT;"
done
left=$(q "SELECT count(*) FROM public.activities WHERE id = '$agent_act';")
[[ "$left" == "1" ]] || fail "activity row must remain"
txt=$(q "SELECT text FROM public.activities WHERE id = '$agent_act';")
[[ "$txt" == "seed activity" ]] || fail "activity text must be unchanged, got $txt"
pass "activities append-only for owner/admin/agent (permission denied on UPDATE/DELETE)"

log "=== C7b: privileged same-org trigger branch (23514) ==="
# Privileged (no RLS): trigger SELECT sees pb; org mismatch raises 23514.
# Isolated proof of internal same-org branch — not an API/JWT user path.
before_fu=$(q "SELECT count(*) FROM public.follow_ups;")
expect_fail '23514' "C7b privileged cross-org follow_up (same-org trigger 23514)" "
  INSERT INTO public.follow_ups (organization_id, client_id, property_id, title, due_date, created_by, updated_by)
  VALUES ('$oa','$ca','$pb','cross-priv', CURRENT_DATE, '$ua','$ua');"
after_fu=$(q "SELECT count(*) FROM public.follow_ups;")
[[ "$after_fu" == "$before_fu" ]] || fail "C7b privileged insert must leave no residual follow_up row"
pass "C7b: privileged same-org trigger branch raises 23514 (property visible, org mismatch)"

log "ALL CLOUD DATA P0 CHECKS PASSED (C1–C9 + R1–R7 role-based DELETE)"
log "NOTE: Dual active membership is blocked by idx_org_members_one_active_per_user (Phase 1 product rule)."
log "      Role-based DELETE is proven on isolated Postgres only; Staging/Production not applied."
