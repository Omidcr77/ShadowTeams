#!/usr/bin/env bash
set -euo pipefail

DB_PATH="${DB_PATH:-/var/www/shadowteams/data/shadowteams.sqlite}"
ONION_HOST_FILE="${ONION_HOST_FILE:-/var/lib/tor/shadowteams/hostname}"

# 1) wait for service endpoint up (up to ~15s)
ok=0
for _ in {1..15}; do
  if curl -fsS --max-time 2 http://127.0.0.1:3000/health >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 1
done
if [[ "$ok" != "1" ]]; then
  echo "[startup-selfcheck] health endpoint not ready" >&2
  exit 1
fi

# 2) db quick check + writable probe
sqlite3 "$DB_PATH" "PRAGMA quick_check;" | grep -q '^ok$'
sqlite3 "$DB_PATH" "CREATE TABLE IF NOT EXISTS _startup_probe (ts TEXT); INSERT INTO _startup_probe(ts) VALUES (datetime('now')); DELETE FROM _startup_probe WHERE rowid IN (SELECT rowid FROM _startup_probe ORDER BY rowid DESC LIMIT 1);" >/dev/null

# 3) onion hostname optional for service boot (warn only if unread/missing)
if [[ ! -r "$ONION_HOST_FILE" ]]; then
  echo "[startup-selfcheck] warning: onion hostname file not readable at $ONION_HOST_FILE" >&2
fi

echo "[startup-selfcheck] ok"
