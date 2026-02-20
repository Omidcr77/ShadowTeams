#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <backup-file.sqlite.gz> [db-path]" >&2
  exit 1
fi

BACKUP_FILE="$1"
DB_PATH="${2:-/var/www/shadowteams/data/shadowteams.sqlite}"
SERVICE_NAME="${SERVICE_NAME:-shadowteams}"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "[restore] ERROR: backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

TMP_DB="$(mktemp /tmp/shadowteams-restore-XXXXXX.sqlite)"
trap 'rm -f "$TMP_DB"' EXIT

gzip -dc "$BACKUP_FILE" > "$TMP_DB"
sqlite3 "$TMP_DB" "PRAGMA quick_check;" | grep -q '^ok$'

echo "[restore] stopping service: $SERVICE_NAME"
systemctl stop "$SERVICE_NAME"

install -d -m 750 "$(dirname "$DB_PATH")"
cp -a "$DB_PATH" "${DB_PATH}.pre-restore.$(date -u +%Y%m%d-%H%M%S)" 2>/dev/null || true
install -m 640 "$TMP_DB" "$DB_PATH"

echo "[restore] starting service: $SERVICE_NAME"
systemctl start "$SERVICE_NAME"
systemctl --no-pager --full status "$SERVICE_NAME" | sed -n '1,12p'

echo "[restore] done: $DB_PATH"
