#!/usr/bin/env bash
# Isolated RLS five-state attribution benchmark for Migration 008 (local GH Actions PG only).
# States:
#   A  = baseline through 007 (existing policies; direct auth.uid())
#   B1 = two separate profile SELECT policies + scalar (SELECT auth.uid())
#   B2 = one consolidated profile SELECT + direct auth.uid() + public.user_active_organization_ids()
#   B3 = one consolidated profile SELECT + scalar (SELECT auth.uid()) + public.user_active_organization_ids()
#   C  = full Migration 008 (private helper + consolidated scalar policy)
# Never run against Supabase, Staging, or Production.
set -euo pipefail

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
export PGPASSWORD
PG_VERSION="${PG_VERSION:-unknown}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-supabase/migrations}"
STUBS_DIR="${STUBS_DIR:-scripts/isolated-pg}"
OUT_DIR="${OUT_DIR:-/tmp/rls-bench-out}"
BASE_DB="rahyar_bench_base"
STATE_B1_DB="rahyar_bench_state_b1"
STATE_B2_DB="rahyar_bench_state_b2"
STATE_B3_DB="rahyar_bench_state_b3"
STATE_C_DB="rahyar_bench_post008"
WARMUP="${WARMUP:-5}"
RUNS="${RUNS:-25}"

case "$PGHOST" in
  127.0.0.1|localhost|::1) ;;
  *) echo "REFUSE: PGHOST=$PGHOST is not loopback" >&2; exit 2 ;;
esac
if [[ -n "${DATABASE_URL:-}" || -n "${SUPABASE_URL:-}" || -n "${SUPABASE_DB_URL:-}" ]]; then
  echo "REFUSE: remote database env vars present" >&2; exit 2
fi
[[ "$BASE_DB" == "rahyar_bench_base" \
  && "$STATE_B1_DB" == "rahyar_bench_state_b1" \
  && "$STATE_B2_DB" == "rahyar_bench_state_b2" \
  && "$STATE_B3_DB" == "rahyar_bench_state_b3" \
  && "$STATE_C_DB" == "rahyar_bench_post008" ]] || {
  echo "REFUSE: unexpected database names" >&2; exit 2
}

mkdir -p "$OUT_DIR"
log() { printf '[%s] %s\n' "$PG_VERSION" "$*"; }
die() { log "FAIL: $*"; exit 1; }
psql_root() { psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres "$@"; }
psql_db() { local d="$1"; shift; psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$d" "$@"; }

ALL_DBS=("$BASE_DB" "$STATE_B1_DB" "$STATE_B2_DB" "$STATE_B3_DB" "$STATE_C_DB")

log "Dropping prior benchmark DBs (named only)"
psql_root -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('$BASE_DB','$STATE_B1_DB','$STATE_B2_DB','$STATE_B3_DB','$STATE_C_DB') AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
for d in "${ALL_DBS[@]}"; do
  psql_root -c "DROP DATABASE IF EXISTS $d;"
done
psql_root -c "CREATE DATABASE $BASE_DB;"

apply_through_007() {
  local db="$1"
  psql_db "$db" -f "$STUBS_DIR/00_auth_and_roles.sql"
  local f
  for f in 001_initial_multitenant.sql 002_business_tables_rls.sql 003_secure_org_policies.sql 004_default_privs_and_profile.sql 005_organization_invitations.sql 006_invite_fk_indexes_and_single_org_create.sql 007_secure_invitation_privacy_and_validation.sql; do
    log "Applying $f -> $db"
    psql_db "$db" -f "$MIGRATIONS_DIR/$f"
  done
}

log "Building baseline through migration 007 (state A)"
apply_through_007 "$BASE_DB"

N_ORGS=100; N_USERS=5000; ROWS_PER_TABLE=100000; HOT_ORGS=5

log "Seeding synthetic data (orgs=$N_ORGS users=$N_USERS rows/table=$ROWS_PER_TABLE)"
psql_db "$BASE_DB" -v ON_ERROR_STOP=1 <<SEED
DO \$\$
DECLARE
  i int; org_ids uuid[] := ARRAY[]::uuid[]; user_ids uuid[] := ARRAY[]::uuid[]; oid uuid; uid uuid;
  members_per int := $N_USERS / $N_ORGS;
BEGIN
  FOR i IN 1..$N_ORGS LOOP
    INSERT INTO public.organizations (name) VALUES ('Bench Org ' || i) RETURNING id INTO oid;
    org_ids := array_append(org_ids, oid);
  END LOOP;
  FOR i IN 1..$N_USERS LOOP
    INSERT INTO auth.users (email) VALUES ('bench-user-' || i || '@example.com') RETURNING id INTO uid;
    user_ids := array_append(user_ids, uid);
    INSERT INTO public.profiles (id, full_name) VALUES (uid, 'User ' || i)
    ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
    oid := org_ids[1 + ((i - 1) % $N_ORGS)];
    INSERT INTO public.organization_members (organization_id, user_id, role, status, joined_at)
    VALUES (oid, uid, CASE WHEN ((i - 1) % members_per) = 0 THEN 'owner'::public.member_role ELSE 'agent'::public.member_role END, 'active', now());
  END LOOP;
  PERFORM setseed(0.42);
  INSERT INTO public.properties (organization_id)
  SELECT CASE WHEN g <= ($ROWS_PER_TABLE * 0.6)::int THEN org_ids[1 + ((g - 1) % $HOT_ORGS)] ELSE org_ids[1 + $HOT_ORGS + ((g - 1) % ($N_ORGS - $HOT_ORGS))] END FROM generate_series(1, $ROWS_PER_TABLE) AS g;
  INSERT INTO public.clients (organization_id)
  SELECT CASE WHEN g <= ($ROWS_PER_TABLE * 0.6)::int THEN org_ids[1 + ((g - 1) % $HOT_ORGS)] ELSE org_ids[1 + $HOT_ORGS + ((g - 1) % ($N_ORGS - $HOT_ORGS))] END FROM generate_series(1, $ROWS_PER_TABLE) AS g;
  INSERT INTO public.needs (organization_id)
  SELECT CASE WHEN g <= ($ROWS_PER_TABLE * 0.6)::int THEN org_ids[1 + ((g - 1) % $HOT_ORGS)] ELSE org_ids[1 + $HOT_ORGS + ((g - 1) % ($N_ORGS - $HOT_ORGS))] END FROM generate_series(1, $ROWS_PER_TABLE) AS g;
  INSERT INTO public.follow_ups (organization_id)
  SELECT CASE WHEN g <= ($ROWS_PER_TABLE * 0.6)::int THEN org_ids[1 + ((g - 1) % $HOT_ORGS)] ELSE org_ids[1 + $HOT_ORGS + ((g - 1) % ($N_ORGS - $HOT_ORGS))] END FROM generate_series(1, $ROWS_PER_TABLE) AS g;
  INSERT INTO public.activities (organization_id)
  SELECT CASE WHEN g <= ($ROWS_PER_TABLE * 0.6)::int THEN org_ids[1 + ((g - 1) % $HOT_ORGS)] ELSE org_ids[1 + $HOT_ORGS + ((g - 1) % ($N_ORGS - $HOT_ORGS))] END FROM generate_series(1, $ROWS_PER_TABLE) AS g;
  CREATE TABLE IF NOT EXISTS public.bench_fixture (k text PRIMARY KEY, v text NOT NULL);
  INSERT INTO public.bench_fixture (k, v) VALUES
    ('org_hot', org_ids[1]::text), ('org_cold', org_ids[$N_ORGS]::text),
    ('uid_hot', user_ids[1]::text), ('uid_cold', user_ids[$N_USERS]::text),
    ('n_orgs', '$N_ORGS'), ('n_users', '$N_USERS'), ('rows_per_table', '$ROWS_PER_TABLE')
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
END;
\$\$;
ANALYZE;
SEED

# --- B1: two separate policies, scalar (SELECT auth.uid()) only ---
log "Cloning baseline -> state B1 (separate policies + scalar auth.uid)"
psql_root -c "CREATE DATABASE $STATE_B1_DB TEMPLATE $BASE_DB;"
psql_db "$STATE_B1_DB" -v ON_ERROR_STOP=1 <<'STATE_B1'
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view profiles in same organization" ON public.profiles;
DROP POLICY IF EXISTS "Users can view profiles in their organizations" ON public.profiles;

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

CREATE POLICY "Users can view profiles in same organization" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR id IN (
      SELECT om.user_id FROM public.organization_members AS om
      WHERE om.status = 'active'
        AND om.organization_id IN (SELECT public.user_active_organization_ids())
    )
  );

ANALYZE public.profiles;
STATE_B1

# --- B2: one consolidated policy, direct auth.uid() ---
log "Cloning baseline -> state B2 (consolidated policy + direct auth.uid)"
psql_root -c "CREATE DATABASE $STATE_B2_DB TEMPLATE $BASE_DB;"
psql_db "$STATE_B2_DB" -v ON_ERROR_STOP=1 <<'STATE_B2'
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view profiles in same organization" ON public.profiles;
DROP POLICY IF EXISTS "Users can view profiles in their organizations" ON public.profiles;

CREATE POLICY "Users can view accessible profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR id IN (
      SELECT om.user_id FROM public.organization_members AS om
      WHERE om.status = 'active'
        AND om.organization_id IN (SELECT public.user_active_organization_ids())
    )
  );

ANALYZE public.profiles;
STATE_B2

# --- B3: one consolidated policy, scalar (SELECT auth.uid()) ---
log "Cloning baseline -> state B3 (consolidated policy + scalar auth.uid)"
psql_root -c "CREATE DATABASE $STATE_B3_DB TEMPLATE $BASE_DB;"
psql_db "$STATE_B3_DB" -v ON_ERROR_STOP=1 <<'STATE_B3'
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view profiles in same organization" ON public.profiles;
DROP POLICY IF EXISTS "Users can view profiles in their organizations" ON public.profiles;

CREATE POLICY "Users can view accessible profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR id IN (
      SELECT om.user_id FROM public.organization_members AS om
      WHERE om.status = 'active'
        AND om.organization_id IN (SELECT public.user_active_organization_ids())
    )
  );

ANALYZE public.profiles;
STATE_B3

# --- C: full Migration 008 ---
log "Cloning baseline -> state C (full Migration 008)"
psql_root -c "CREATE DATABASE $STATE_C_DB TEMPLATE $BASE_DB;"
log "Applying migration 008 to state C only"
psql_db "$STATE_C_DB" -f "$MIGRATIONS_DIR/008_rls_helper_schema_and_profile_policy_optimization.sql"
psql_db "$STATE_C_DB" -c "ANALYZE;"

ORG_HOT=$(psql_db "$BASE_DB" -Atc "SELECT v FROM public.bench_fixture WHERE k='org_hot'")
UID_HOT=$(psql_db "$BASE_DB" -Atc "SELECT v FROM public.bench_fixture WHERE k='uid_hot'")
PROP_ID=$(psql_db "$BASE_DB" -Atc "SELECT id::text FROM public.properties WHERE organization_id='$ORG_HOT'::uuid ORDER BY id LIMIT 1")
[[ -n "$ORG_HOT" && -n "$UID_HOT" && -n "$PROP_ID" ]] || die "fixture ids missing"

CSV="$OUT_DIR/medians_pg${PG_VERSION}.csv"
JSON_SUM="$OUT_DIR/summary_pg${PG_VERSION}.json"
PLAN_DIR="$OUT_DIR/plans_pg${PG_VERSION}"
RAW_DIR="$OUT_DIR/raw_pg${PG_VERSION}"
mkdir -p "$PLAN_DIR" "$RAW_DIR"
echo "pg_version,mode,query,median_exec_ms,median_plan_ms,rows,parity_ok" > "$CSV"

parse_explain() {
  local path="$1" is_update="${2:-0}"
  python3 - "$path" "$is_update" <<'PY'
import json, sys
path, is_update = sys.argv[1], sys.argv[2]
raw = open(path).read().strip()
if not raw:
    print("PARSE_FAIL: empty plan file", file=sys.stderr); sys.exit(3)
j = None
try:
    j = json.loads(raw)
except Exception:
    start, end = raw.find("["), raw.rfind("]")
    if start < 0 or end < 0:
        print("PARSE_FAIL: no JSON array", file=sys.stderr)
        print(raw[:800], file=sys.stderr)
        sys.exit(3)
    try:
        j = json.loads(raw[start:end+1])
    except Exception as e:
        print(f"PARSE_FAIL: {e}", file=sys.stderr)
        print(raw[:800], file=sys.stderr)
        sys.exit(3)
if not isinstance(j, list) or not j or "Plan" not in j[0]:
    print("PARSE_FAIL: missing Plan", file=sys.stderr); sys.exit(3)
ex, pl = j[0].get("Execution Time"), j[0].get("Planning Time")
if ex is None or pl is None:
    print("PARSE_FAIL: missing times", file=sys.stderr); sys.exit(3)
plan = j[0]["Plan"]; rows = plan.get("Actual Rows")
if is_update == "1":
    def find_scan_rows(node):
        nt = node.get("Node Type") or ""
        if nt in ("Seq Scan", "Index Scan", "Index Only Scan", "Bitmap Heap Scan", "Tid Scan", "Bitmap Index Scan"):
            return node.get("Actual Rows")
        for ch in node.get("Plans") or []:
            r = find_scan_rows(ch)
            if r is not None: return r
        return node.get("Actual Rows")
    rows = find_scan_rows(plan)
if rows is None:
    print("PARSE_FAIL: missing Actual Rows", file=sys.stderr); sys.exit(3)
print(f"{ex}|{pl}|{rows}")
PY
}

capture_explain() {
  local db="$1" sql="$2" as_auth="$3" out_file="$4" tmp_sql
  tmp_sql=$(mktemp)
  if [[ "$as_auth" == "1" ]]; then
    cat > "$tmp_sql" <<EOS
BEGIN;
SELECT auth.set_test_uid('$UID_HOT'::uuid);
SET LOCAL ROLE authenticated;
\\o $out_file
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON) $sql;
\\o
ROLLBACK;
EOS
  else
    cat > "$tmp_sql" <<EOS
\\o $out_file
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON) $sql;
\\o
EOS
  fi
  psql -X -A -t -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$db" -f "$tmp_sql" >/dev/null
  rm -f "$tmp_sql"
  [[ -s "$out_file" ]] || die "empty EXPLAIN output: $out_file"
  head -c 1 "$out_file" | grep -q '\[' || die "EXPLAIN output does not start with JSON array: $out_file"
}

measure() {
  local mode="$1" db="$2" qname="$3" sql="$4" as_auth="$5" is_update="${6:-0}"
  local times=() plans=() rows_last="" i rawf parsed exec_ms plan_ms rows
  for i in $(seq 1 $((WARMUP + RUNS))); do
    rawf="$RAW_DIR/${mode}_${qname}_s${i}.json"
    capture_explain "$db" "$sql" "$as_auth" "$rawf"
    parsed=$(parse_explain "$rawf" "$is_update") || die "parse failed mode=$mode query=$qname sample=$i"
    IFS='|' read -r exec_ms plan_ms rows <<<"$parsed"
    if [[ $i -gt $WARMUP ]]; then times+=("$exec_ms"); plans+=("$plan_ms"); rows_last="$rows"; fi
    if [[ $i -eq $((WARMUP + 1)) ]]; then cp "$rawf" "$PLAN_DIR/${mode}_${qname}.json"; fi
  done
  [[ ${#times[@]} -eq $RUNS ]] || die "expected $RUNS samples for $mode/$qname"
  local med_e med_p
  med_e=$(printf '%s\n' "${times[@]}" | sort -n | awk '{a[NR]=$1} END{if(NR%2) print a[(NR+1)/2]; else print (a[NR/2]+a[NR/2+1])/2}')
  med_p=$(printf '%s\n' "${plans[@]}" | sort -n | awk '{a[NR]=$1} END{if(NR%2) print a[(NR+1)/2]; else print (a[NR/2]+a[NR/2+1])/2}')
  python3 -c "e=float('$med_e'); p=float('$med_p'); assert e >= 0 and p >= 0; assert not (e == 0 and p == 0), 'both medians zero'" \
    || die "invalid median mode=$mode query=$qname exec=$med_e plan=$med_p"
  echo "$med_e|$med_p|$rows_last"
}

auth_query() {
  local db="$1" sql="$2"
  psql -X -A -t -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$db" <<EOS
BEGIN;
SELECT auth.set_test_uid('$UID_HOT'::uuid);
SET LOCAL ROLE authenticated;
$sql;
ROLLBACK;
EOS
}

auth_count() {
  local db="$1" sql="$2" out
  out=$(auth_query "$db" "$sql" | grep -E '^[0-9]+$' | head -n1 || true)
  [[ -n "$out" ]] || die "auth_count: no integer result for: $sql"
  printf '%s' "$out"
}

require_count() {
  local label="$1" got="$2" expected="$3"
  [[ "$got" == "$expected" ]] || die "$label: expected count $expected got '$got'"
}

id_hash() { printf '%s' "$1" | sha256sum | awk '{print $1}'; }

record() {
  local mode="$1" qname="$2" med="$3" parity="$4" e p r
  IFS='|' read -r e p r <<<"$med"
  echo "$PG_VERSION,$mode,$qname,$e,$p,$r,$parity" >> "$CSV"
  log "RESULT mode=$mode query=$qname median_exec_ms=$e median_plan_ms=$p rows=$r parity=$parity"
}

safe_measure_record() {
  local mode="$1" db="$2" qname="$3" sql="$4" as_auth="$5" is_update="${6:-0}" parity="$7"
  local med rc
  set +e
  med=$(measure "$mode" "$db" "$qname" "$sql" "$as_auth" "$is_update")
  rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    die "measure failed mode=$mode query=$qname (rc=$rc) — aborting before record"
  fi
  [[ -n "$med" ]] || die "measure returned empty for mode=$mode query=$qname"
  record "$mode" "$qname" "$med" "$parity"
}

sql_roster="SELECT id FROM public.profiles ORDER BY id LIMIT 50"
sql_own="SELECT id FROM public.profiles WHERE id = '$UID_HOT'::uuid"
sql_pk="SELECT id, organization_id FROM public.properties WHERE id = '$PROP_ID'::uuid"
sql_upd="UPDATE public.properties SET organization_id = organization_id WHERE id = '$PROP_ID'::uuid"

STATES=(
  "state_a:$BASE_DB"
  "state_b1:$STATE_B1_DB"
  "state_b2:$STATE_B2_DB"
  "state_b3:$STATE_B3_DB"
  "state_c:$STATE_C_DB"
)

for state_label in "${STATES[@]}"; do
  mode="${state_label%%:*}"
  db="${state_label##*:}"
  require_count "$mode profile_roster" "$(auth_count "$db" "SELECT count(*) FROM ($sql_roster) s")" "50"
  require_count "$mode profile_own" "$(auth_count "$db" "SELECT count(*) FROM ($sql_own) s")" "1"
  require_count "$mode pk" "$(auth_count "$db" "SELECT count(*) FROM ($sql_pk) s")" "1"
  require_count "$mode update" "$(auth_count "$db" "WITH u AS (UPDATE public.properties SET organization_id = organization_id WHERE id = '$PROP_ID'::uuid RETURNING 1) SELECT count(*) FROM u")" "1"
done

declare -A ROSTER_HASH
ref_hash=""
for state_label in "${STATES[@]}"; do
  mode="${state_label%%:*}"
  db="${state_label##*:}"
  ids=$(auth_query "$db" "$sql_roster" | grep -E '^[0-9a-f-]{36}$' || true)
  [[ -n "$ids" ]] || die "roster empty under $mode"
  h=$(id_hash "$ids")
  ROSTER_HASH[$mode]="$h"
  if [[ -z "$ref_hash" ]]; then
    ref_hash="$h"
  else
    [[ "$h" == "$ref_hash" ]] || die "roster id mismatch $mode vs state_a"
  fi
done
log "Visibility parity OK across A/B1/B2/B3/C (roster hash match, counts match)"

# Sequential measurement (same proven order as prior 3-state runner; interleaving
# across five DBs would require a larger redesign of measure()/RAW naming and is
# not applied here to avoid risk).
for state_label in "${STATES[@]}"; do
  mode="${state_label%%:*}"
  db="${state_label##*:}"
  safe_measure_record "$mode" "$db" "profile_roster" "$sql_roster" 1 0 "yes"
done
for state_label in "${STATES[@]}"; do
  mode="${state_label%%:*}"
  db="${state_label##*:}"
  safe_measure_record "$mode" "$db" "profile_own" "$sql_own" 1 0 "yes"
done
for state_label in "${STATES[@]}"; do
  mode="${state_label%%:*}"
  db="${state_label##*:}"
  safe_measure_record "$mode" "$db" "pk_properties" "$sql_pk" 1 0 "yes"
done
for state_label in "${STATES[@]}"; do
  mode="${state_label%%:*}"
  db="${state_label##*:}"
  safe_measure_record "$mode" "$db" "update_properties" "$sql_upd" 1 1 "rollback"
done

python3 - <<PY
import json, glob, os, sys
plan_dir = "$PLAN_DIR"
evidence, errors = [], 0
for path in sorted(glob.glob(plan_dir + "/*.json")):
    try:
        raw = open(path).read().strip()
        try:
            j = json.loads(raw)
        except Exception:
            j = json.loads(raw[raw.find("["):raw.rfind("]")+1])
        plan = j[0]["Plan"]
        def find_filter(n):
            if n.get("Filter"): return n["Filter"]
            for c in n.get("Plans") or []:
                r = find_filter(c)
                if r: return r
            return None
        evidence.append({
            "file": os.path.basename(path),
            "execution_time_ms": j[0]["Execution Time"],
            "planning_time_ms": j[0]["Planning Time"],
            "has_initplan": "initplan" in raw.lower(),
            "node_type": plan.get("Node Type"),
            "filter_snippet": (find_filter(plan) or "")[:200],
            "actual_rows": plan.get("Actual Rows"),
        })
    except Exception as e:
        errors += 1
        evidence.append({"file": os.path.basename(path), "error": str(e)})
if errors:
    print("SUMMARY_FAIL", errors, file=sys.stderr)
    sys.exit(1)
modes = ("state_a", "state_b1", "state_b2", "state_b3", "state_c")
queries = ("profile_roster", "profile_own", "pk_properties")
required = [f"{m}_{q}.json" for m in modes for q in queries]
for n in required:
    if not os.path.isfile(os.path.join(plan_dir, n)):
        print("missing required plan", n, file=sys.stderr)
        sys.exit(1)
summary = {
    "pg_version": "$PG_VERSION",
    "experiment": "A_baseline_B1_separate_scalar_B2_consol_direct_B3_consol_scalar_C_full_008",
    "dataset": {"orgs": $N_ORGS, "users": $N_USERS, "rows_per_table": $ROWS_PER_TABLE, "hot_orgs": $HOT_ORGS, "members_per_org": $N_USERS // $N_ORGS},
    "methodology": {"warmup": $WARMUP, "runs": $RUNS, "sampling": "sequential_per_state"},
    "fixture": {"org_hot": "$ORG_HOT", "uid_hot": "$UID_HOT", "prop_id": "$PROP_ID"},
    "plan_evidence": evidence,
}
json.dump(summary, open("$JSON_SUM", "w"), indent=2)
print(json.dumps({"pg_version": summary["pg_version"], "plans": len(evidence), "errors": 0}))
PY

python3 - <<PY
import csv, sys
bad = []
modes = {"state_a", "state_b1", "state_b2", "state_b3", "state_c"}
queries = {"profile_roster", "profile_own", "pk_properties", "update_properties"}
seen = set()
with open("$CSV") as f:
    for row in csv.DictReader(f):
        mode, q = row["mode"], row["query"]
        seen.add((mode, q))
        if mode not in modes:
            bad.append(row); continue
        try:
            e = float(row["median_exec_ms"]); p = float(row["median_plan_ms"])
        except ValueError:
            bad.append(row); continue
        if e == 0 and p == 0:
            bad.append(row)
        if row["parity_ok"] not in ("yes", "rollback"):
            bad.append(row)
expected = {(m, q) for m in modes for q in queries}
missing = expected - seen
if missing:
    print("CSV_FAIL missing rows", sorted(missing), file=sys.stderr)
    sys.exit(1)
if len(seen) != 20:
    print("CSV_FAIL expected 20 rows got", len(seen), file=sys.stderr)
    sys.exit(1)
if bad:
    print("CSV_FAIL", bad, file=sys.stderr)
    sys.exit(1)
print("CSV validation OK (20 rows, 5 states x 4 queries)")
PY

log "CSV written: $CSV"
log "Summary written: $JSON_SUM"
log "FIVE-STATE A/B1/B2/B3/C ATTRIBUTION BENCHMARK COMPLETE"
