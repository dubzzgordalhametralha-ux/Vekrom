#!/usr/bin/env bash
# Restaura um backup. CUIDADO: substitui os dados atuais.
#   ~/vekrom/scripts/restore.sh /home/vekrom/backups/db-AAAAMMDD-HHMM.dump [uploads-AAAAMMDD-HHMM.tar.gz]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DUMP=${1:?informe o arquivo db-*.dump}
TARBALL=${2:-}
DB=$(grep -E '^DATABASE_URL=' "$ROOT/.env" | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')

read -r -p "Isso apaga os dados atuais e volta para $(basename "$DUMP"). Digite RESTAURAR: " ok
[ "$ok" = "RESTAURAR" ] || { echo "cancelado"; exit 1; }

sudo systemctl stop vekrom-api vekrom-gateway 2>/dev/null || echo "(pare a API/gateway antes, se o sudo não deixar)"
pg_restore --clean --if-exists --no-owner --single-transaction --dbname="$DB" "$DUMP"
if [ -n "$TARBALL" ]; then
  tar -xzf "$TARBALL" -C /home/vekrom
fi
sudo systemctl restart vekrom-api vekrom-gateway
echo "restaurado."
