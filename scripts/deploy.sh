#!/usr/bin/env bash
# Deploy do Vekrom no servidor. Rode como o usuário vekrom, de qualquer pasta:
#   ~/vekrom/scripts/deploy.sh
# Puxa o código, instala, roda migrations, builda API/gateway/web e reinicia.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
envget() { grep -E "^$1=" "$ROOT/.env" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

log "Código ($(git rev-parse --abbrev-ref HEAD))"
git pull --ff-only

log "Dependências"
pnpm install --frozen-lockfile

log "Migrations"
(cd apps/api && node --env-file="$ROOT/.env" --import tsx src/db/migrate.ts)

log "Build API e gateway"
pnpm --filter @vekrom/api build
pnpm --filter @vekrom/gateway build

log "Build web"
ORIGIN=$(envget CORS_ORIGIN | cut -d, -f1)
(
  cd apps/web
  export NODE_OPTIONS=--max-old-space-size=512 VITE_API_URL=/api VITE_GATEWAY_URL="${ORIGIN/https:/wss:}/ws"
  npx tsc --noEmit
  npx vite build --outDir dist-next --emptyOutDir
  # Mantém os assets antigos por 14 dias: quem está com a aba aberta não quebra ao trocar de tela.
  [ -d dist/assets ] && cp -rp --update=none dist/assets/. dist-next/assets/
  find dist-next/assets -type f -mtime +14 -delete
  rm -rf dist-prev && { [ -d dist ] && mv dist dist-prev || true; } && mv dist-next dist && rm -rf dist-prev
)

log "Reiniciando"
sudo systemctl restart vekrom-api vekrom-gateway
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1 && curl -fsS http://127.0.0.1:3002/health >/dev/null 2>&1; then
    log "No ar: $(curl -fsS http://127.0.0.1:3001/health)"
    exit 0
  fi
  sleep 1
done
echo "API ou gateway não respondeu. Veja: sudo journalctl -u vekrom-api -u vekrom-gateway -n 80" >&2
exit 1
