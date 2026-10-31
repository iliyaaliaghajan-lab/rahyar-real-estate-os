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

extract_uuid() {
  echo "$1" | grep -oE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' | head -1
}

psql_root() { psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$ROOT_DB" "$@"; }
psql_db() { psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" "$@"; }
q() { psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$WORK_DB" -At -c "$1"; }

cleanup() {
  log "Cleanup: drop $WORK_DB"
  psql_root -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$WORK_DB' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
  psql_root -c "DROP DATABASE IF EXISTS $WORK_DB;" >/dev/null 2>&1 || true
}
trap cleanup EXIT

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

  rm -f "$barrier" "$out1" "$out2" "${out1}.rc" "${out2}.rc"
  pass "Test B round $round: exactly one accept; one membership; status=accepted"
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

  rm -f "$barrier" "$out1" "$out2" "${out1}.rc" "${out2}.rc"
  pass "Test C round $round: one success, one active membership, one accepted invite"
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
