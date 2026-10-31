#!/usr/bin/env bash
# Isolated Postgres tenant-isolation matrix (T1–T6) against the canonical
# eight-migration chain. Temporary DB only — never Staging/Production.
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
psql_db() { psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" "$@"; }
q() { psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -At -c "$1"; }

as_auth() {
  local uid="$1"; local sql="$2"
  psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -At <<EOF
BEGIN;
SET LOCAL ROLE authenticated;
SELECT auth.set_test_uid('$uid');
$sql
COMMIT;
EOF
}
as_auth_count() {
  local uid="$1"; local sql="$2"; local out
  out=$(as_auth "$uid" "$sql" 2>/dev/null | grep -E '^[0-9]+$' | tail -1)
  echo "${out:-0}"
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

log "Applying stubs + canonical 8 migrations (Staging chronology)"
psql_db -f "$STUBS_DIR/00_auth_and_roles.sql" >/dev/null
for f in \
  20261022230848_initial_multitenant.sql \
  20261022230858_business_tables_rls.sql \
  20261022230904_secure_org_policies.sql \
  20261022230911_default_privs_and_profile.sql \
  20261022230925_organization_invitations.sql \
  20261026115345_secure_invitation_privacy_and_validation.sql \
  20261027003152_invite_fk_indexes_and_single_org_create.sql \
  20261029181022_rls_helper_schema_and_profile_policy_optimization.sql
do
  log "  -> $f"
  psql_db -f "$MIGRATIONS_DIR/$f" >/dev/null
done

log "=== Migration 008 verification ==="
priv_fn=$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'private' AND p.proname = 'user_organization_ids';")
[[ "$priv_fn" == "1" ]] || fail "private.user_organization_ids() missing after Migration 008"
pass "private.user_organization_ids() present"
pub_legacy=$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('user_organization_ids','user_active_organization_ids');")
[[ "$pub_legacy" == "0" ]] || fail "legacy public helper functions still present: $pub_legacy"
pass "legacy public helpers absent"
create_priv=$(q "SELECT has_schema_privilege('authenticated', 'private', 'CREATE')::text || '|' || has_schema_privilege('anon', 'private', 'CREATE')::text;")
[[ "$create_priv" == "false|false" ]] || fail "API roles have CREATE on private: $create_priv"
pass "anon/authenticated lack CREATE on private schema"

log "Seeding two organizations and business rows"
owner_a=$(extract_uuid "$(q "INSERT INTO auth.users (email, raw_user_meta_data) VALUES ('owner_a@test.local', '{\"full_name\":\"Owner A\"}'::jsonb) RETURNING id;")")
owner_b=$(extract_uuid "$(q "INSERT INTO auth.users (email, raw_user_meta_data) VALUES ('owner_b@test.local', '{\"full_name\":\"Owner B\"}'::jsonb) RETURNING id;")")
[[ -n "$owner_a" && -n "$owner_b" && "$owner_a" != "$owner_b" ]] || fail "seed users failed: a=$owner_a b=$owner_b"
q "INSERT INTO public.profiles (id, full_name) VALUES ('$owner_a', 'Owner A') ON CONFLICT (id) DO NOTHING;" >/dev/null
q "INSERT INTO public.profiles (id, full_name) VALUES ('$owner_b', 'Owner B') ON CONFLICT (id) DO NOTHING;" >/dev/null
org_a=$(extract_uuid "$(q "INSERT INTO public.organizations (name, slug) VALUES ('Org A', 'org-a-$$') RETURNING id;")")
org_b=$(extract_uuid "$(q "INSERT INTO public.organizations (name, slug) VALUES ('Org B', 'org-b-$$') RETURNING id;")")
[[ -n "$org_a" && -n "$org_b" ]] || fail "org seed failed"
q "INSERT INTO public.organization_members (organization_id, user_id, role, status, joined_at)
   VALUES ('$org_a', '$owner_a', 'owner', 'active', now()),
          ('$org_b', '$owner_b', 'owner', 'active', now());" >/dev/null
BUSINESS_TABLES=(properties clients needs follow_ups activities)
for t in "${BUSINESS_TABLES[@]}"; do
  q "INSERT INTO public.$t (organization_id) VALUES ('$org_a'), ('$org_b');" >/dev/null
done
for t in "${BUSINESS_TABLES[@]}"; do
  c=$(q "SELECT count(*) FROM public.$t;")
  [[ "$c" == "2" ]] || fail "expected 2 seed rows in $t, got $c"
done
pass "seeded 2 orgs, 2 owners, 2 rows per business table"

visible_count() { local uid="$1" table="$2"; as_auth_count "$uid" "SELECT count(*) FROM public.$table;"; }

log "=== T1: Cross-tenant SELECT ==="
for t in "${BUSINESS_TABLES[@]}"; do
  ca=$(visible_count "$owner_a" "$t")
  cb=$(visible_count "$owner_b" "$t")
  [[ "$ca" == "1" ]] || fail "T1 Owner A should see 1 row in $t, got $ca"
  [[ "$cb" == "1" ]] || fail "T1 Owner B should see 1 row in $t, got $cb"
  bid=$(q "SELECT id::text FROM public.$t WHERE organization_id = '$org_b' LIMIT 1;")
  seen=$(as_auth_count "$owner_a" "SELECT count(*) FROM public.$t WHERE id = '$bid';")
  [[ "$seen" == "0" ]] || fail "T1 Owner A must not see Org B row in $t"
done
pass "T1: each owner sees only own-tenant rows (5 tables)"

log "=== T2: Cross-tenant INSERT ==="
for t in "${BUSINESS_TABLES[@]}"; do
  set +e
  err=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -c "
    BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$owner_a');
    INSERT INTO public.$t (organization_id) VALUES ('$org_b');
    COMMIT;" 2>&1)
  rc=$?
  set -e
  [[ $rc -ne 0 ]] || fail "T2 Owner A must not INSERT into Org B for $t"
  echo "$err" | grep -qiE "row-level security|violates row-level security|permission denied|42501|new row violates" \
    || fail "T2 expected RLS rejection for $t, got: $err"
done
for t in "${BUSINESS_TABLES[@]}"; do
  c=$(q "SELECT count(*) FROM public.$t WHERE organization_id = '$org_b';")
  [[ "$c" == "1" ]] || fail "T2 Org B $t row count changed: $c"
done
pass "T2: cross-tenant INSERT rejected by RLS on all 5 tables"

log "=== T3: Cross-tenant UPDATE ==="
for t in "${BUSINESS_TABLES[@]}"; do
  bid=$(q "SELECT id::text FROM public.$t WHERE organization_id = '$org_b' LIMIT 1;")
  aid=$(q "SELECT id::text FROM public.$t WHERE organization_id = '$org_a' LIMIT 1;")
  n=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -At -c "
    DO \$\$
    DECLARE n int;
    BEGIN
      PERFORM set_config('role', 'authenticated', true);
      PERFORM auth.set_test_uid('$owner_a');
      UPDATE public.$t SET organization_id = organization_id WHERE id = '$bid';
      GET DIAGNOSTICS n = ROW_COUNT;
      PERFORM set_config('role', 'none', true);
      RAISE NOTICE 'affected=%', n;
    END \$\$;
  " 2>&1 | grep -oE 'affected=[0-9]+' | cut -d= -f2)
  [[ "${n:-x}" == "0" ]] || fail "T3 UPDATE foreign row in $t should affect 0 rows, got ${n:-none}"
  set +e
  move_err=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -c "
    BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$owner_a');
    UPDATE public.$t SET organization_id = '$org_b' WHERE id = '$aid';
    COMMIT;" 2>&1)
  set -e
  final_org=$(q "SELECT organization_id::text FROM public.$t WHERE id = '$aid';")
  [[ "$final_org" == "$org_a" ]] || fail "T3 org_id move must not succeed for $t (final=$final_org)"
done
pass "T3: cross-tenant UPDATE blocked; org_id move prevented"

log "=== T4: Cross-tenant DELETE ==="
for t in "${BUSINESS_TABLES[@]}"; do
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
      RAISE NOTICE 'deleted=%', n;
    END \$\$;
  " 2>&1 | grep -oE 'deleted=[0-9]+' | cut -d= -f2)
  [[ "${n:-x}" == "0" ]] || fail "T4 DELETE foreign $t should affect 0 rows, got ${n:-none}"
  still=$(q "SELECT count(*) FROM public.$t WHERE id = '$bid';")
  [[ "$still" == "1" ]] || fail "T4 Org B row in $t must still exist"
done
pass "T4: cross-tenant DELETE affects 0 rows; foreign rows remain"

log "=== T5: Own-tenant DML ==="
for t in "${BUSINESS_TABLES[@]}"; do
  new_id=$(extract_uuid "$(as_auth "$owner_a" "INSERT INTO public.$t (organization_id) VALUES ('$org_a') RETURNING id;")")
  [[ -n "$new_id" ]] || fail "T5 INSERT own into $t failed"
  c=$(as_auth_count "$owner_a" "SELECT count(*) FROM public.$t WHERE id = '$new_id';")
  [[ "$c" == "1" ]] || fail "T5 SELECT own $t failed"
  n=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -At -c "
    DO \$\$
    DECLARE n int;
    BEGIN
      PERFORM set_config('role', 'authenticated', true);
      PERFORM auth.set_test_uid('$owner_a');
      UPDATE public.$t SET organization_id = '$org_a' WHERE id = '$new_id';
      GET DIAGNOSTICS n = ROW_COUNT;
      PERFORM set_config('role', 'none', true);
      RAISE NOTICE 'updated=%', n;
    END \$\$;
  " 2>&1 | grep -oE 'updated=[0-9]+' | cut -d= -f2)
  [[ "${n:-0}" == "1" ]] || fail "T5 UPDATE own $t should affect 1, got ${n:-none}"
  n=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -At -c "
    DO \$\$
    DECLARE n int;
    BEGIN
      PERFORM set_config('role', 'authenticated', true);
      PERFORM auth.set_test_uid('$owner_a');
      DELETE FROM public.$t WHERE id = '$new_id';
      GET DIAGNOSTICS n = ROW_COUNT;
      PERFORM set_config('role', 'none', true);
      RAISE NOTICE 'deleted=%', n;
    END \$\$;
  " 2>&1 | grep -oE 'deleted=[0-9]+' | cut -d= -f2)
  [[ "${n:-0}" == "1" ]] || fail "T5 DELETE own $t should affect 1, got ${n:-none}"
done
for t in "${BUSINESS_TABLES[@]}"; do
  cb=$(visible_count "$owner_b" "$t")
  [[ "$cb" == "1" ]] || fail "T5 Owner B visibility on $t broken: $cb"
done
pass "T5: own-tenant CRUD works; peer isolation holds"

log "=== T6: Organization and membership write protection ==="
set +e
err=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -c "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$owner_a');
  INSERT INTO public.organizations (name) VALUES ('Forged Org');
  COMMIT;" 2>&1)
rc=$?
set -e
[[ $rc -ne 0 ]] || fail "T6 authenticated must not INSERT organizations"
echo "$err" | grep -qiE "permission denied|row-level security|42501|violates" || fail "T6 expected rejection for org INSERT: $err"
pass "T6: direct organization INSERT blocked"

set +e
err=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -c "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$owner_a');
  INSERT INTO public.organization_members (organization_id, user_id, role, status)
  VALUES ('$org_b', '$owner_a', 'owner', 'active');
  COMMIT;" 2>&1)
rc=$?
set -e
[[ $rc -ne 0 ]] || fail "T6 authenticated must not INSERT forged membership"
echo "$err" | grep -qiE "permission denied|row-level security|42501|violates" || fail "T6 expected rejection for membership INSERT: $err"
pass "T6: forged membership INSERT blocked"

set +e
err=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -c "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$owner_a');
  UPDATE public.organization_members SET role = 'admin' WHERE user_id = '$owner_b';
  COMMIT;" 2>&1)
set -e
role_b=$(q "SELECT role::text FROM public.organization_members WHERE user_id = '$owner_b';")
[[ "$role_b" == "owner" ]] || fail "T6 Owner B role must remain owner, got $role_b"
pass "T6: cannot change another member's role"

set +e
err=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -c "
  BEGIN; SET LOCAL ROLE authenticated; SELECT auth.set_test_uid('$owner_a');
  DELETE FROM public.organization_members WHERE user_id = '$owner_b';
  COMMIT;" 2>&1)
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
log "  - T2 INSERT rejection: PASS"
log "  - T3 UPDATE blocked: PASS"
log "  - T4 DELETE blocked: PASS"
log "  - T5 own-tenant CRUD: PASS"
log "  - T6 org/membership writes: PASS"
log "  - Migration 008 private helper: PASS"
log "Temporary DB $WORK_DB dropped on exit."
log "=============================================="
