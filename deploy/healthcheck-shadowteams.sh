#!/usr/bin/env bash
set -euo pipefail

LOG_PREFIX="[healthcheck]"
TS="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
DB_PATH="${DB_PATH:-/var/www/shadowteams/data/shadowteams.sqlite}"
ONION_HOST_FILE="${ONION_HOST_FILE:-/var/lib/tor/shadowteams/hostname}"

status() {
  local svc="$1" out
  out="$(systemctl is-active "$svc" 2>/dev/null || true)"
  if [[ -n "$out" ]]; then
    echo "$out"
  else
    echo "unknown"
  fi
}

HTTP_OK="fail"
if curl -fsS --max-time 8 http://127.0.0.1:3000/health >/dev/null 2>&1; then
  HTTP_OK="ok"
fi

DB_OK="fail"
if [[ -f "$DB_PATH" ]]; then
  if sqlite3 "$DB_PATH" "PRAGMA quick_check;" 2>/dev/null | grep -q '^ok$'; then
    DB_OK="ok"
  fi
fi

ONION_LEN="unknown"
if [[ -r "$ONION_HOST_FILE" ]]; then
  ONION_LEN="$(wc -c < "$ONION_HOST_FILE" | tr -d ' ')"
fi

echo "$LOG_PREFIX ts=$TS shadowteams=$(status shadowteams) tor=$(status tor) nginx=$(status nginx || true) apache2=$(status apache2 || true) http=$HTTP_OK db=$DB_OK onion_hostname_bytes=$ONION_LEN"
