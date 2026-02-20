#!/usr/bin/env bash
set -euo pipefail

DB_PATH="${1:-/var/www/shadowteams/data/shadowteams.sqlite}"
BACKUP_DIR="${2:-/var/backups/shadowteams}"
KEEP_DAYS="${KEEP_DAYS:-14}"

if [[ ! -f "$DB_PATH" ]]; then
  echo "[backup] ERROR: DB not found: $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 750 "$BACKUP_DIR" || true

TS="$(date -u +%Y%m%d-%H%M%S)"
BASE="shadowteams-${TS}"
OUT_DB="$BACKUP_DIR/${BASE}.sqlite"
OUT_GZ="$OUT_DB.gz"

# Consistent online backup using sqlite backup API
sqlite3 "$DB_PATH" ".timeout 5000" ".backup '$OUT_DB'"

# Optional integrity check
sqlite3 "$OUT_DB" "PRAGMA quick_check;" | grep -q '^ok$'

# Compress and lock down
gzip -9 "$OUT_DB"
chmod 640 "$OUT_GZ" || true

echo "[backup] created: $OUT_GZ"

# Retention cleanup
find "$BACKUP_DIR" -type f -name 'shadowteams-*.sqlite.gz' -mtime +"$KEEP_DAYS" -delete

echo "[backup] retention: kept last ${KEEP_DAYS} days"
