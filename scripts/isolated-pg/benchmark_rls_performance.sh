#!/usr/bin/env bash
# Isolated RLS performance benchmark for Migration 008 (local GH Actions PG only).
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
POST_DB="rahyar_bench_post008"
WARMUP="${WARMUP:-5}"
RUNS="${RUNS:-25}"

# --- hard isolation gates ---
case "$PGHOST" in
  127.0.0.1|localhost|::1) ;;
  *) echo "REFUSE: PGHOST=$PGHOST is not loopback" >&2; exit 2 ;;
esac
if [[ -n "${DATABASE_URL:-}" || -n "${SUPABASE_URL:-}" || -n "${SUPABASE_DB_URL:-}" ]]; then
  echo "REFUSE: remote database env vars present" >&2; exit 2
fi
[[ "$BASE_DB" == "rahyar_bench_base" && "$POST_DB" == "rahyar_bench_post008" ]] || {
  echo "REFUSE: unexpected database names" >&2; exit 2
}

mkdir -p "$OUT_DIR"
log() { printf '[%s] %s\n' "$PG_VERSION" "$*"; }
psql_root() { psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres "$@"; }
psql_db() { local d="$1"; shift; psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$d" "$@"; }

log "Dropping prior benchmark DBs (named only)"
psql_root -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('$BASE_DB','$POST_DB') AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
psql_root -c "DROP DATABASE IF EXISTS $BASE_DB;"
psql_root -c "DROP DATABASE IF EXISTS $POST_DB;"
psql_root -c "CREATE DATABASE $BASE_DB;"

apply_through_007() {
  local db="$1"
  psql_db "$db" -f "$STUBS_DIR/00_auth_and_roles.sql"
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
    log "Applying $f -> $db"
    psql_db "$db" -f "$MIGRATIONS_DIR/$f"
  done
}

log "Building baseline through migration 007"
apply_through_007 "$BASE_DB"

# Dataset knobs (recorded in summary)
N_ORGS=100
N_USERS=5000          # 50 active members per org
ROWS_PER_TABLE=100000
HOT_ORGS=5            # first 5 orgs hold ~60% of rows

log "Seeding synthetic data (orgs=$N_ORGS users=$N_USERS rows/table=$ROWS_PER_TABLE)"
psql_db "$BASE_DB" -v ON_ERROR_STOP=1 <<SEED
DO \$\$
DECLARE
  i int;
  org_ids uuid[] := ARRAY[]::uuid[];
  user_ids uuid[] := ARRAY[]::uuid[];
  oid uuid;
  uid uuid;
  members_per int := $N_USERS / $N_ORGS;
BEGIN
  FOR i IN 1..$N_ORGS LOOP
    INSERT INTO public.organizations (name)
    VALUES ('Bench Org ' || i)
    RETURNING id INTO oid;
    org_ids := array_append(org_ids, oid);
  END LOOP;

  FOR i IN 1..$N_USERS LOOP
    INSERT INTO auth.users (email)
    VALUES ('bench-user-' || i || '@example.com')
    RETURNING id INTO uid;
    user_ids := array_append(user_ids, uid);
    INSERT INTO public.profiles (id, full_name)
    VALUES (uid, 'User ' || i)
    ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
    oid := org_ids[1 + ((i - 1) % $N_ORGS)];
    INSERT INTO public.organization_members (organization_id, user_id, role, status, joined_at)
    VALUES (oid, uid, CASE WHEN ((i - 1) % members_per) = 0 THEN 'owner'::public.member_role ELSE 'agent'::public.member_role END,
            'active', now());
  END LOOP;

  PERFORM setseed(0.42);
  INSERT INTO public.properties (organization_id)
  SELECT CASE
    WHEN g <= ($ROWS_PER_TABLE * 0.6)::int THEN org_ids[1 + ((g - 1) % $HOT_ORGS)]
    ELSE org_ids[1 + $HOT_ORGS + ((g - 1) % ($N_ORGS - $HOT_ORGS))]
  END
  FROM generate_series(1, $ROWS_PER_TABLE) AS g;

  INSERT INTO public.clients (organization_id)
  SELECT CASE
    WHEN g <= ($ROWS_PER_TABLE * 0.6)::int THEN org_ids[1 + ((g - 1) % $HOT_ORGS)]
    ELSE org_ids[1 + $HOT_ORGS + ((g - 1) % ($N_ORGS - $HOT_ORGS))]
  END
  FROM generate_series(1, $ROWS_PER_TABLE) AS g;

  INSERT INTO public.needs (organization_id)
  SELECT CASE
    WHEN g <= ($ROWS_PER_TABLE * 0.6)::int THEN org_ids[1 + ((g - 1) % $HOT_ORGS)]
    ELSE org_ids[1 + $HOT_ORGS + ((g - 1) % ($N_ORGS - $HOT_ORGS))]
  END
  FROM generate_series(1, $ROWS_PER_TABLE) AS g;

  INSERT INTO public.follow_ups (organization_id)
  SELECT CASE
    WHEN g <= ($ROWS_PER_TABLE * 0.6)::int THEN org_ids[1 + ((g - 1) % $HOT_ORGS)]
    ELSE org_ids[1 + $HOT_ORGS + ((g - 1) % ($N_ORGS - $HOT_ORGS))]
  END
  FROM generate_series(1, $ROWS_PER_TABLE) AS g;

  INSERT INTO public.activities (organization_id)
  SELECT CASE
    WHEN g <= ($ROWS_PER_TABLE * 0.6)::int THEN org_ids[1 + ((g - 1) % $HOT_ORGS)]
    ELSE org_ids[1 + $HOT_ORGS + ((g - 1) % ($N_ORGS - $HOT_ORGS))]
  END
  FROM generate_series(1, $ROWS_PER_TABLE) AS g;

  CREATE TABLE IF NOT EXISTS public.bench_fixture (
    k text PRIMARY KEY,
    v text NOT NULL
  );
  INSERT INTO public.bench_fixture (k, v) VALUES
    ('org_hot', org_ids[1]::text),
    ('org_cold', org_ids[$N_ORGS]::text),
    ('uid_hot', user_ids[1]::text),
    ('uid_cold', user_ids[$N_USERS]::text),
    ('n_orgs', '$N_ORGS'),
    ('n_users', '$N_USERS'),
    ('rows_per_table', '$ROWS_PER_TABLE')
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
END;
\$\$;
ANALYZE;
SEED

log "Cloning baseline -> post-008 DB"
psql_root -c "CREATE DATABASE $POST_DB TEMPLATE $BASE_DB;"
log "Applying migration 008 to clone only"
psql_db "$POST_DB" -f "$MIGRATIONS_DIR/008_rls_helper_schema_and_profile_policy_optimization.sql"
psql_db "$POST_DB" -c "ANALYZE;"

ORG_HOT=$(psql_db "$BASE_DB" -Atc "SELECT v FROM public.bench_fixture WHERE k='org_hot'")
ORG_COLD=$(psql_db "$BASE_DB" -Atc "SELECT v FROM public.bench_fixture WHERE k='org_cold'")
UID_HOT=$(psql_db "$BASE_DB" -Atc "SELECT v FROM public.bench_fixture WHERE k='uid_hot'")
UID_COLD=$(psql_db "$BASE_DB" -Atc "SELECT v FROM public.bench_fixture WHERE k='uid_cold'")
PROP_ID=$(psql_db "$BASE_DB" -Atc "SELECT id::text FROM public.properties WHERE organization_id='$ORG_HOT'::uuid LIMIT 1")

CSV="$OUT_DIR/medians_pg${PG_VERSION}.csv"
JSON_SUM="$OUT_DIR/summary_pg${PG_VERSION}.json"
PLAN_DIR="$OUT_DIR/plans_pg${PG_VERSION}"
mkdir -p "$PLAN_DIR"
echo "pg_version,mode,query,median_exec_ms,median_plan_ms,rows,parity_ok" > "$CSV"

measure() {
  local mode="$1" db="$2" qname="$3" sql="$4" as_auth="$5"
  local times=() plans=() rows_last=0 i out exec_ms plan_ms
  for i in $(seq 1 $((WARMUP + RUNS))); do
    if [[ "$as_auth" == "1" ]]; then
      out=$(psql_db "$db" -Atc "
        BEGIN;
        SELECT auth.set_test_uid('$UID_HOT'::uuid);
        SET LOCAL ROLE authenticated;
        EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON) $sql;
        ROLLBACK;
      ")
    else
      out=$(psql_db "$db" -Atc "EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON) $sql")
    fi
    out=$(echo "$out" | tr -d '\n')
    exec_ms=$(python3 -c "import json,sys; j=json.loads(sys.argv[1]); print(j[0].get('Execution Time',0))" "$out" 2>/dev/null || echo 0)
    plan_ms=$(python3 -c "import json,sys; j=json.loads(sys.argv[1]); print(j[0].get('Planning Time',0))" "$out" 2>/dev/null || echo 0)
    rows_last=$(python3 -c "import json,sys; j=json.loads(sys.argv[1]); print(j[0]['Plan'].get('Actual Rows',0))" "$out" 2>/dev/null || echo 0)
    if [[ $i -gt $WARMUP ]]; then
      times+=("$exec_ms")
      plans+=("$plan_ms")
    fi
    if [[ $i -eq $((WARMUP + 1)) ]]; then
      echo "$out" > "$PLAN_DIR/${mode}_${qname}.json"
    fi
  done
  local med_e med_p
  med_e=$(printf '%s\n' "${times[@]}" | sort -n | awk '{a[NR]=$1} END{if(NR%2) print a[(NR+1)/2]; else print (a[NR/2]+a[NR/2+1])/2}')
  med_p=$(printf '%s\n' "${plans[@]}" | sort -n | awk '{a[NR]=$1} END{if(NR%2) print a[(NR+1)/2]; else print (a[NR/2]+a[NR/2+1])/2}')
  echo "$med_e|$med_p|$rows_last"
}

parity_count() {
  local db="$1" sql="$2" as_auth="$3"
  if [[ "$as_auth" == "1" ]]; then
    psql_db "$db" -Atc "
      BEGIN;
      SELECT auth.set_test_uid('$UID_HOT'::uuid);
      SET LOCAL ROLE authenticated;
      $sql;
      ROLLBACK;
    "
  else
    psql_db "$db" -Atc "$sql"
  fi
}

record() {
  local mode="$1" qname="$2" med="$3" parity="$4"
  local e p r
  IFS='|' read -r e p r <<<"$med"
  echo "$PG_VERSION,$mode,$qname,$e,$p,$r,$parity" >> "$CSV"
  log "RESULT mode=$mode query=$qname median_exec_ms=$e median_plan_ms=$p rows=$r parity=$parity"
}

for t in properties clients needs follow_ups activities; do
  sql="SELECT id FROM public.$t LIMIT 50"
  c_base=$(parity_count "$BASE_DB" "SELECT count(*) FROM ($sql) s" 1)
  c_post=$(parity_count "$POST_DB" "SELECT count(*) FROM ($sql) s" 1)
  par="yes"; [[ "$c_base" == "$c_post" ]] || par="NO:$c_base!=$c_post"
  record "pre008_rls" "list_$t" "$(measure pre008_rls "$BASE_DB" "list_$t" "$sql" 1)" "$par"
  record "post008_rls" "list_$t" "$(measure post008_rls "$POST_DB" "list_$t" "$sql" 1)" "$par"
  sqlc="SELECT id FROM public.$t WHERE organization_id = '$ORG_HOT'::uuid LIMIT 50"
  record "control_explicit" "list_$t" "$(measure control_explicit "$BASE_DB" "list_$t" "$sqlc" 0)" "diagnostic"
done

sql="SELECT id, organization_id FROM public.properties WHERE id = '$PROP_ID'::uuid"
c_base=$(parity_count "$BASE_DB" "SELECT count(*) FROM ($sql) s" 1)
c_post=$(parity_count "$POST_DB" "SELECT count(*) FROM ($sql) s" 1)
par="yes"; [[ "$c_base" == "$c_post" ]] || par="NO"
record "pre008_rls" "pk_properties" "$(measure pre008_rls "$BASE_DB" "pk_properties" "$sql" 1)" "$par"
record "post008_rls" "pk_properties" "$(measure post008_rls "$POST_DB" "pk_properties" "$sql" 1)" "$par"
record "control_explicit" "pk_properties" "$(measure control_explicit "$BASE_DB" "pk_properties" "$sql AND organization_id = '$ORG_HOT'::uuid" 0)" "diagnostic"

sql_own="SELECT id FROM public.profiles WHERE id = '$UID_HOT'::uuid"
c_base=$(parity_count "$BASE_DB" "SELECT count(*) FROM ($sql_own) s" 1)
c_post=$(parity_count "$POST_DB" "SELECT count(*) FROM ($sql_own) s" 1)
par="yes"; [[ "$c_base" == "$c_post" ]] || par="NO"
record "pre008_rls" "profile_own" "$(measure pre008_rls "$BASE_DB" "profile_own" "$sql_own" 1)" "$par"
record "post008_rls" "profile_own" "$(measure post008_rls "$POST_DB" "profile_own" "$sql_own" 1)" "$par"

c_base=$(parity_count "$BASE_DB" "SELECT count(*) FROM public.profiles" 1)
c_post=$(parity_count "$POST_DB" "SELECT count(*) FROM public.profiles" 1)
par="yes"; [[ "$c_base" == "$c_post" ]] || par="NO:$c_base!=$c_post"
record "pre008_rls" "profile_roster" "$(measure pre008_rls "$BASE_DB" "profile_roster" "SELECT id FROM public.profiles LIMIT 50" 1)" "$par"
record "post008_rls" "profile_roster" "$(measure post008_rls "$POST_DB" "profile_roster" "SELECT id FROM public.profiles LIMIT 50" 1)" "$par"

sql_upd="UPDATE public.properties SET organization_id = organization_id WHERE id = '$PROP_ID'::uuid"
record "pre008_rls" "update_properties" "$(measure pre008_rls "$BASE_DB" "update_properties" "$sql_upd" 1)" "rollback"
record "post008_rls" "update_properties" "$(measure post008_rls "$POST_DB" "update_properties" "$sql_upd" 1)" "rollback"
record "control_explicit" "update_properties" "$(measure control_explicit "$BASE_DB" "update_properties" "UPDATE public.properties SET organization_id = organization_id WHERE id = '$PROP_ID'::uuid AND organization_id = '$ORG_HOT'::uuid" 0)" "diagnostic"

python3 - <<PY
import json, glob, os
plan_dir = "$PLAN_DIR"
evidence = []
for path in sorted(glob.glob(plan_dir + "/*.json")):
    try:
        with open(path) as f:
            raw = f.read().strip()
        j = json.loads(raw)
        text = raw.lower()
        evidence.append({
            "file": os.path.basename(path),
            "execution_time_ms": j[0].get("Execution Time"),
            "planning_time_ms": j[0].get("Planning Time"),
            "has_initplan": "initplan" in text,
            "has_subplan": "subplan" in text,
            "node_type": j[0]["Plan"].get("Node Type"),
            "index_cond": j[0]["Plan"].get("Index Cond") or (j[0]["Plan"].get("Plans", [{}])[0].get("Index Cond") if j[0]["Plan"].get("Plans") else None),
        })
    except Exception as e:
        evidence.append({"file": os.path.basename(path), "error": str(e)})
summary = {
    "pg_version": "$PG_VERSION",
    "dataset": {
        "orgs": $N_ORGS,
        "users": $N_USERS,
        "rows_per_table": $ROWS_PER_TABLE,
        "hot_orgs": $HOT_ORGS,
        "members_per_org": $N_USERS // $N_ORGS,
    },
    "methodology": {"warmup": $WARMUP, "runs": $RUNS},
    "fixture": {"org_hot": "$ORG_HOT", "uid_hot": "$UID_HOT", "prop_id": "$PROP_ID"},
    "plan_evidence": evidence,
}
with open("$JSON_SUM", "w") as f:
    json.dump(summary, f, indent=2)
print(json.dumps(summary, indent=2)[:2000])
PY

log "CSV written: $CSV"
log "Summary written: $JSON_SUM"
log "BENCHMARK COMPLETE"
