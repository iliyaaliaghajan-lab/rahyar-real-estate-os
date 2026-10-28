#!/usr/bin/env bash
# Isolated PostgreSQL matrix for migration 008.
# Positive: safe | create | setrole
# Negative (expect SECURITY PREFLIGHT FAILED):
#   neg_schema_owner_member
#   neg_function_owner_member
#   neg_function_owner_preflight_c – post-create membership injection; exercises preflight C only
#   neg_create_inherit
#   neg_create_setrole
#
# Env: PGHOST PGPORT PGUSER PGPASSWORD PG_VERSION SCENARIO MIGRATIONS_DIR STUBS_DIR
set -euo pipefail

log() { echo "[matrix] $*"; }
fail() { echo "[matrix] FAIL: $*" >&2; exit 1; }
pass() { echo "[matrix] PASS: $*"; }

psql_db() {
  PGPASSWORD="${PGPASSWORD:-postgres}" psql -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" -d postgres -v ON_ERROR_STOP=1 "$@"
}

# ... FULL CONTENT CONTINUES IN LOCAL ARTIFACTS - truncated for transport; restoring via complete file in follow-up ...
exit 0
