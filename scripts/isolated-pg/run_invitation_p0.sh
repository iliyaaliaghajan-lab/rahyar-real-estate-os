#!/usr/bin/env bash
# Isolated Postgres P0 invitation security tests (expiration + concurrent accept).
# Never connect to Supabase / Staging / Production.
set -euo pipefail

PGHOST="${PGHOST:-/var/run/postgresql}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
export PGHOST PGPORT PGUSER
if [[ -n "${PGPASSWORD:-}" ]]; then
  export PGPASSWORD
else
  unset PGPASSWORD 2>/dev/null || true
fi

MIGRATIONS_DIR="${MIGRATIONS_DIR:-supabase/migrations}"
STUBS_DIR="${STUBS_DIR:-scripts/isolated-pg}"
ROOT_DB="postgres"
WORK_DB="rahyar_inv_p0_$$"
CONCURRENCY_ROUNDS="${CONCURRENCY_ROUNDS:-5}"

log() { printf '[p0] %s\n' "$*"; }
pass() { log "PASS: $*"; }
fail() { log "FAIL: $*"; exit 1; }

# ---------------------------------------------------------------------------
# Safety: refuse non-local PostgreSQL targets before any DB mutation.
# Best-effort guard; does NOT protect against a local tunnel to a remote DB.
# ---------------------------------------------------------------------------
is_loopback_ip() {
  local ip="$1"
  case "$ip" in
    127.*|::1|0:0:0:0:0:0:0:1) return 0 ;;
    *) return 1 ;;
  esac
}

is_local_socket_path() {
  local h="$1"
  case "$h" in
    /var/run/postgresql|/var/run/postgresql/*|/tmp|/tmp/*|/run/postgresql|/run/postgresql/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

assert_local_target() {
  if [[ -n "${PGHOSTADDR:-}" ]]; then
    if ! is_loopback_ip "$PGHOSTADDR"; then
      fail "Refusing non-loopback PGHOSTADDR='${PGHOSTADDR}'. Only localhost/127.0.0.1/::1 allowed."
    fi
  fi

  local host="$PGHOST"
  if [[ -z "$host" || "$host" == "localhost" ]]; then
    :
  elif is_loopback_ip "$host"; then
    :
  elif is_local_socket_path "$host"; then
    :
  else
    fail "Refusing PGHOST='${host}'. Only localhost, 127.0.0.1, ::1, or local Unix socket paths are allowed."
  fi
}

is_valid_ipv4() {
  local ip="$1"
  [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  local o
  IFS=. read -r -a parts <<< "$ip"
  for o in "${parts[@]}"; do
    [[ "$o" =~ ^[0-9]+$ ]] || return 1
    (( 10#$o >= 0 && 10#$o <= 255 )) || return 1
  done
  return 0
}

# True when client connects via explicit loopback (required for CI service exception).
is_loopback_pghost() {
  local host="${PGHOST:-}"
  [[ -z "$host" || "$host" == "localhost" ]] && return 0
  is_loopback_ip "$host" && return 0
  return 1
}

assert_server_is_local() {
  local addr
  addr=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$ROOT_DB" -At -c "SELECT COALESCE(host(inet_server_addr()), '');" 2>/dev/null || echo "QUERY_FAILED")
  if [[ "$addr" == "QUERY_FAILED" ]]; then
    fail "Could not query inet_server_addr(); refusing to proceed."
  fi

  # Unix socket or loopback server address: always allowed.
  if [[ -z "$addr" ]]; then
    log "Server address check: Unix socket (inet_server_addr is NULL) — allowed"
    return 0
  fi
  if is_loopback_ip "$addr"; then
    log "Server address check: ${addr} (loopback) — allowed"
    return 0
  fi

  # Narrow CI-only exception: GitHub Actions job service container IP.
  # The workflow inspects job.services.postgres.id and exports the exact IPv4
  # as P0_ALLOWED_SERVER_ADDR. We accept that address only when every condition
  # below holds. Arbitrary private/RFC1918 ranges are NOT allowed.
  if [[ "${GITHUB_ACTIONS:-}" == "true" \
     && "${P0_ALLOW_SERVICE_CONTAINER:-}" == "1" \
     && -n "${P0_ALLOWED_SERVER_ADDR:-}" ]]; then
    if ! is_loopback_pghost; then
      fail "CI service-container exception requires loopback PGHOST (got '${PGHOST}')."
    fi
    if [[ -n "${PGHOSTADDR:-}" ]] && ! is_loopback_ip "$PGHOSTADDR"; then
      fail "CI service-container exception requires empty or loopback PGHOSTADDR (got '${PGHOSTADDR}')."
    fi
    if ! is_valid_ipv4 "$P0_ALLOWED_SERVER_ADDR"; then
      fail "P0_ALLOWED_SERVER_ADDR is not a valid IPv4 address."
    fi
    if [[ "$addr" == "$P0_ALLOWED_SERVER_ADDR" ]]; then
      log "Server address check: ${addr} matches inspected GHA postgres service container — allowed"
      return 0
    fi
    fail "Refusing server address inet_server_addr()='${addr}' (does not match inspected service IP '${P0_ALLOWED_SERVER_ADDR}')."
  fi

  fail "Refusing non-loopback server address from inet_server_addr()='${addr}'. Only local Postgres is allowed (or exact GHA service container IP with explicit opt-in)."
}

extract_uuid() {
  echo "$1" | grep -oE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' | head -1
}

psql_root() { psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$ROOT_DB" "$@"; }
psql_db() { psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" "$@"; }
q() { psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -At -c "$1"; }

cleanup() {
  if [[ "${SAFETY_OK:-0}" != "1" ]]; then
    return 0
  fi
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

log "Applying stubs + migrations 001..007"
psql_db -f "$STUBS_DIR/00_auth_and_roles.sql" >/dev/null
for f in \
  001_initial_multitenant.sql \
  002_business_tables_rls.sql \
  003_secure_org_policies.sql \
  004_default_privs_and_profile.sql \
  005_organization_invitations.sql \
  006_invite_fk_indexes_and_single_org_create.sql \
  007_secure_invitation_privacy_and_validation.sql
do
  log "  -> $f"
  psql_db -f "$MIGRATIONS_DIR/$f" >/dev/null
done

idx=$(q "SELECT count(*) FROM pg_indexes WHERE indexname = 'idx_org_members_one_active_per_user';")
[[ "$idx" == "1" ]] || fail "idx_org_members_one_active_per_user missing"
pass "idx_org_members_one_active_per_user present"

create_user() {
  local email="$1"
  local out
  out=$(q "INSERT INTO auth.users (email, raw_user_meta_data) VALUES ('$email', '{\"full_name\":\"Test\"}'::jsonb) RETURNING id;")
  extract_uuid "$out"
}

create_org() {
  local uid="$1" name="$2"
  local out
  out=$(q "SELECT auth.set_test_uid('$uid'); SELECT organization_id FROM public.create_organization_with_owner('$name');")
  extract_uuid "$out"
}

create_invite() {
  local owner_uid="$1" email="$2"
  local out
  out=$(q "SELECT auth.set_test_uid('$owner_uid'); SELECT invitation_id::text || '|' || token FROM public.create_organization_invitation('$email', 'agent');")
  echo "$out" | grep -E '\|' | head -1
}

run_test_a() {
  log "=== Test A: Invitation expired ==="
  local suffix=$RANDOM$RANDOM
  local owner_id invitee_id org_id inv_line inv_id token

  owner_id=$(create_user "owner_a_${suffix}@test.local")
  invitee_id=$(create_user "invitee_a_${suffix}@test.local")
  org_id=$(create_org "$owner_id" "Org A ${suffix}")
  [[ -n "$owner_id" && -n "$invitee_id" && -n "$org_id" ]] || fail "Test A setup failed"

  inv_line=$(create_invite "$owner_id" "invitee_a_${suffix}@test.local")
  inv_id=$(echo "$inv_line" | cut -d'|' -f1)
  token=$(echo "$inv_line" | cut -d'|' -f2 | tr -d '[:space:]')
  [[ -n "$inv_id" && ${#token} -ge 32 ]] || fail "Test A invite create failed: [$inv_line]"

  q "UPDATE public.organization_invitations SET expires_at = now() - interval '1 hour' WHERE id = '$inv_id';" >/dev/null

  local accept_err rc=0
  set +e
  accept_err=$(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -c "
    SELECT auth.set_test_uid('$invitee_id');
    SELECT * FROM public.accept_organization_invitation('$token');
  " 2>&1)
  rc=$?
  set -e

  echo "$accept_err" | grep -qi "Invitation expired" || fail "Test A expected 'Invitation expired', got: $accept_err"
  [[ $rc -ne 0 ]] || fail "Test A accept should have failed"

  local status member_count
  status=$(q "SELECT status FROM public.organization_invitations WHERE id = '$inv_id';")
  member_count=$(q "SELECT count(*) FROM public.organization_members WHERE user_id = '$invitee_id' AND status = 'active';")
  [[ "$status" == "pending" ]] || fail "Test A status should remain pending, got $status"
  [[ "$member_count" == "0" ]] || fail "Test A no membership expected, got $member_count"

  pass "Test A: expired invitation rejected; status=pending; no membership"
}

run_test_b_once() {
  local round="$1"
  local suffix="${round}_$RANDOM$RANDOM"
  local owner_id invitee_id org_id inv_line inv_id token

  owner_id=$(create_user "owner_b_${suffix}@test.local")
  invitee_id=$(create_user "invitee_b_${suffix}@test.local")
  org_id=$(create_org "$owner_id" "Org B ${suffix}")
  inv_line=$(create_invite "$owner_id" "invitee_b_${suffix}@test.local")
  inv_id=$(echo "$inv_line" | cut -d'|' -f1)
  token=$(echo "$inv_line" | cut -d'|' -f2 | tr -d '[:space:]')
  [[ ${#token} -ge 32 ]] || fail "Test B r$round no token"

  local barrier="/tmp/p0_barrier_b_${suffix}"
  local out1="/tmp/p0_out_b1_${suffix}" out2="/tmp/p0_out_b2_${suffix}"
  rm -f "$barrier" "$out1" "$out2" "${out1}.rc" "${out2}.rc"

  (
    while [[ ! -f "$barrier" ]]; do sleep 0.005; done
    set +e
    psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -c "
      SELECT auth.set_test_uid('$invitee_id');
      SELECT * FROM public.accept_organization_invitation('$token');
    " >"$out1" 2>&1
    echo $? >"${out1}.rc"
  ) &
  local pid1=$!
  (
    while [[ ! -f "$barrier" ]]; do sleep 0.005; done
    set +e
    psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -c "
      SELECT auth.set_test_uid('$invitee_id');
      SELECT * FROM public.accept_organization_invitation('$token');
    " >"$out2" 2>&1
    echo $? >"${out2}.rc"
  ) &
  local pid2=$!

  sleep 0.03
  touch "$barrier"
  wait "$pid1" "$pid2" || true

  local rc1 rc2 success=0
  rc1=$(cat "${out1}.rc" 2>/dev/null || echo 99)
  rc2=$(cat "${out2}.rc" 2>/dev/null || echo 99)
  [[ "$rc1" == "0" ]] && success=$((success+1))
  [[ "$rc2" == "0" ]] && success=$((success+1))

  local member_count status accepted_by
  member_count=$(q "SELECT count(*) FROM public.organization_members WHERE user_id = '$invitee_id' AND status = 'active';")
  status=$(q "SELECT status FROM public.organization_invitations WHERE id = '$inv_id';")
  accepted_by=$(q "SELECT COALESCE(accepted_by::text,'') FROM public.organization_invitations WHERE id = '$inv_id';")

  if [[ "$success" -ne 1 || "$member_count" != "1" || "$status" != "accepted" || "$accepted_by" != "$invitee_id" ]]; then
    log "Test B r$round debug: success=$success members=$member_count status=$status accepted_by=$accepted_by"
    log "--- conn1 rc=$rc1 ---"; cat "$out1" || true
    log "--- conn2 rc=$rc2 ---"; cat "$out2" || true
    fail "Test B r$round failed invariants"
  fi

  local loser_out="" loser_rc=""
  if [[ "$rc1" != "0" && "$rc2" == "0" ]]; then
    loser_out="$out1"; loser_rc="$rc1"
  elif [[ "$rc2" != "0" && "$rc1" == "0" ]]; then
    loser_out="$out2"; loser_rc="$rc2"
  else
    fail "Test B r$round: could not identify a unique losing connection (rc1=$rc1 rc2=$rc2)"
  fi

  if ! grep -qi "Invitation already accepted" "$loser_out"; then
    log "Test B r$round loser (rc=$loser_rc) output:"
    cat "$loser_out" || true
    fail "Test B r$round: loser must report 'Invitation already accepted'"
  fi

  rm -f "$barrier" "$out1" "$out2" "${out1}.rc" "${out2}.rc"
  pass "Test B round $round: exactly one accept; loser got 'Invitation already accepted'"
}

run_test_b() {
  log "=== Test B: Concurrent same-token accept (${CONCURRENCY_ROUNDS} rounds) ==="
  local r
  for r in $(seq 1 "$CONCURRENCY_ROUNDS"); do
    run_test_b_once "$r"
  done
  pass "Test B: all $CONCURRENCY_ROUNDS concurrent rounds passed"
}

run_test_c_once() {
  local round="$1"
  local suffix="${round}_$RANDOM$RANDOM"
  local owner1_id owner2_id invitee_id org1_id org2_id
  local inv1_line inv1_id token1 inv2_line inv2_id token2

  owner1_id=$(create_user "owner1_c_${suffix}@test.local")
  owner2_id=$(create_user "owner2_c_${suffix}@test.local")
  invitee_id=$(create_user "invitee_c_${suffix}@test.local")
  org1_id=$(create_org "$owner1_id" "Org C1 ${suffix}")
  org2_id=$(create_org "$owner2_id" "Org C2 ${suffix}")

  inv1_line=$(create_invite "$owner1_id" "invitee_c_${suffix}@test.local")
  inv1_id=$(echo "$inv1_line" | cut -d'|' -f1)
  token1=$(echo "$inv1_line" | cut -d'|' -f2 | tr -d '[:space:]')
  inv2_line=$(create_invite "$owner2_id" "invitee_c_${suffix}@test.local")
  inv2_id=$(echo "$inv2_line" | cut -d'|' -f1)
  token2=$(echo "$inv2_line" | cut -d'|' -f2 | tr -d '[:space:]')
  [[ "$token1" != "$token2" && ${#token1} -ge 32 && ${#token2} -ge 32 ]] || fail "Test C r$round bad tokens"

  local barrier="/tmp/p0_barrier_c_${suffix}"
  local out1="/tmp/p0_out_c1_${suffix}" out2="/tmp/p0_out_c2_${suffix}"
  rm -f "$barrier" "$out1" "$out2" "${out1}.rc" "${out2}.rc"

  (
    while [[ ! -f "$barrier" ]]; do sleep 0.005; done
    set +e
    psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -c "
      SELECT auth.set_test_uid('$invitee_id');
      SELECT * FROM public.accept_organization_invitation('$token1');
    " >"$out1" 2>&1
    echo $? >"${out1}.rc"
  ) &
  local pid1=$!
  (
    while [[ ! -f "$barrier" ]]; do sleep 0.005; done
    set +e
    psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -c "
      SELECT auth.set_test_uid('$invitee_id');
      SELECT * FROM public.accept_organization_invitation('$token2');
    " >"$out2" 2>&1
    echo $? >"${out2}.rc"
  ) &
  local pid2=$!

  sleep 0.03
  touch "$barrier"
  wait "$pid1" "$pid2" || true

  local rc1 rc2 success=0
  rc1=$(cat "${out1}.rc" 2>/dev/null || echo 99)
  rc2=$(cat "${out2}.rc" 2>/dev/null || echo 99)
  [[ "$rc1" == "0" ]] && success=$((success+1))
  [[ "$rc2" == "0" ]] && success=$((success+1))

  local member_count accepted_count
  member_count=$(q "SELECT count(*) FROM public.organization_members WHERE user_id = '$invitee_id' AND status = 'active';")
  accepted_count=$(q "SELECT count(*) FROM public.organization_invitations WHERE id IN ('$inv1_id','$inv2_id') AND status = 'accepted';")

  if [[ "$success" -ne 1 || "$member_count" != "1" || "$accepted_count" != "1" ]]; then
    log "Test C r$round debug: success=$success members=$member_count accepted=$accepted_count"
    log "--- conn1 rc=$rc1 ---"; cat "$out1" || true
    log "--- conn2 rc=$rc2 ---"; cat "$out2" || true
    fail "Test C r$round failed invariants"
  fi

  local winner_inv loser_inv loser_out loser_rc
  if [[ "$rc1" == "0" && "$rc2" != "0" ]]; then
    winner_inv="$inv1_id"
    loser_inv="$inv2_id"
    loser_out="$out2"
    loser_rc="$rc2"
  elif [[ "$rc2" == "0" && "$rc1" != "0" ]]; then
    winner_inv="$inv2_id"
    loser_inv="$inv1_id"
    loser_out="$out1"
    loser_rc="$rc1"
  else
    fail "Test C r$round: could not identify unique winner/loser (rc1=$rc1 rc2=$rc2)"
  fi

  if ! grep -qiE "User already belongs to another organization|idx_org_members_one_active_per_user|duplicate key value violates unique constraint" "$loser_out"; then
    log "Test C r$round loser (rc=$loser_rc) output:"
    cat "$loser_out" || true
    fail "Test C r$round: loser must report unique-index violation or 'User already belongs to another organization'"
  fi

  local loser_status
  loser_status=$(q "SELECT status FROM public.organization_invitations WHERE id = '$loser_inv';")
  [[ "$loser_status" == "pending" ]] || fail "Test C r$round: losing invitation must stay pending, got $loser_status"

  local winner_accepted_by winner_status
  winner_status=$(q "SELECT status FROM public.organization_invitations WHERE id = '$winner_inv';")
  winner_accepted_by=$(q "SELECT COALESCE(accepted_by::text,'') FROM public.organization_invitations WHERE id = '$winner_inv';")
  [[ "$winner_status" == "accepted" ]] || fail "Test C r$round: winner invitation must be accepted, got $winner_status"
  [[ "$winner_accepted_by" == "$invitee_id" ]] || fail "Test C r$round: accepted_by mismatch"

  local active_org winner_org_id
  active_org=$(q "SELECT organization_id::text FROM public.organization_members WHERE user_id = '$invitee_id' AND status = 'active';")
  winner_org_id=$(q "SELECT organization_id::text FROM public.organization_invitations WHERE id = '$winner_inv';")
  [[ "$active_org" == "$winner_org_id" ]] || fail "Test C r$round: active membership org ($active_org) != accepted invite org ($winner_org_id)"

  rm -f "$barrier" "$out1" "$out2" "${out1}.rc" "${out2}.rc"
  pass "Test C round $round: one success; loser correct error; pending loser; accepted_by/org match"
}

run_test_c() {
  log "=== Test C: Concurrent different-token two-org accept (${CONCURRENCY_ROUNDS} rounds) ==="
  local r
  for r in $(seq 1 "$CONCURRENCY_ROUNDS"); do
    run_test_c_once "$r"
  done
  pass "Test C: all $CONCURRENCY_ROUNDS concurrent rounds passed"
}

run_test_a
run_test_b
run_test_c

log "=============================================="
log "ALL P0 INVITATION TESTS PASSED"
log "  - Test A (expiration): PASS"
log "  - Test B (same token concurrent x${CONCURRENCY_ROUNDS}): PASS"
log "  - Test C (two tokens / two orgs concurrent x${CONCURRENCY_ROUNDS}): PASS"
log "Temporary DB $WORK_DB dropped on exit."
log "=============================================="
