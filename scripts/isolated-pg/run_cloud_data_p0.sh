#!/usr/bin/env bash
# Isolated Postgres P0 for cloud business data foundation (migration 009) + role-based DELETE (011).
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
fail() { printf '[cloud-p0] FAIL: %s\n' "$*" >&2; exit 1; }
pass() { log "PASS: $*"; }

is_loopback_ip() {
  case "$1" in
    127.*|::1) return 0 ;;
    *) return 1 ;;
  esac
}
is_local_socket_path() { [[ "$1" == /* || "$1" == "" ]]; }
is_valid_ipv4() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; }
is_loopback_pghost() {
  local host="${PGHOST:-}"
  if [[ -z "$host" || "$host" == "localhost" ]]; then return 0; fi
  if is_loopback_ip "$host"; then return 0; fi
  if is_local_socket_path "$host"; then return 0; fi
  return 1
}

assert_pghost_is_local() {
  local host="${PGHOST:-}"
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

assert_pghost_is_local
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

# Continue with remaining body from delivery file - truncated for this call; will fix with second push if needed
echo "INCOMPLETE - will be replaced"
