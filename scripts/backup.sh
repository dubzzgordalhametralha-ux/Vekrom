#!/usr/bin/env bash
# Backup diário (systemd timer vekrom-backup): banco + uploads, guarda 7 dias.
#   ~/vekrom/scripts/backup.sh          roda na hora
# Restaurar: scripts/restore.sh (veja o README).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST=${BACKUP_DIR:-/home/vekrom/backups}
UPLOADS=$(grep -E '^UPLOAD_DIR=' "$ROOT/.env" | cut -d= -f2- || true)
UPLOADS=${UPLOADS:-/home/vekrom/uploads}
STAMP=$(date +%Y%m%d-%H%M)
mkdir -p "$DEST" && chmod 700 "$DEST"
umask 077

DB=$(grep -E '^DATABASE_URL=' "$ROOT/.env" | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
pg_dump --format=custom --compress=6 --no-owner --file="$DEST/db-$STAMP.dump.partial" "$DB"
mv "$DEST/db-$STAMP.dump.partial" "$DEST/db-$STAMP.dump"

if [ -d "$UPLOADS" ]; then
  tar -czf "$DEST/uploads-$STAMP.tar.gz.partial" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")"
  mv "$DEST/uploads-$STAMP.tar.gz.partial" "$DEST/uploads-$STAMP.tar.gz"
fi

find "$DEST" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'uploads-*.tar.gz' \) -mtime +7 -delete
find "$DEST" -maxdepth 1 -name '*.partial' -mmin +120 -delete
echo "backup ok: $DEST/db-$STAMP.dump ($(du -h "$DEST/db-$STAMP.dump" | cut -f1))"
