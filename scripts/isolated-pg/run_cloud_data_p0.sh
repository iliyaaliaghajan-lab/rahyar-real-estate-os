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
  if [[ -n "${PGHOSTADDR:-}" ]] && ! is_loopback_ip "$PGHOSTADDR"; then fail "Refusing non-loopback PGHOSTADDR='${PGHOST}