# Vekrom: comunidade, jogos e conversas

Servidores, canais de texto e voz, DMs, amigos, convites por link e chamadas com tela, em tempo real.

```
apps/api       REST (Fastify 5 + Postgres + Redis)
apps/gateway   WebSocket (ws): eventos em tempo real, presença, sinalização de voz
apps/web       React 18 + Vite + Tailwind + Radix + React Query + Zustand
apps/media     stub
infra/         Caddy, systemd, Postgres/Redis para 1 GB, coturn
scripts/       deploy, backup, restore, teste de fumaça
```

## Rodar local

Requisitos: Node 22+, pnpm 9. Postgres 16 e Redis 7 são opcionais em dev.

```bash
cp .env.example .env
pnpm install
pnpm db:migrate          # aplica as migrations pendentes (precisa de DATABASE_URL)
pnpm db:seed             # dados de exemplo: alice@example.com / bob@example.com, senha password123
pnpm dev                 # api :3001, gateway :3002, web :5173
```

Sem Postgres a API cai para **pg-mem** vazio (crie a conta pelo cadastro), e sem Redis usa memória. Isso **só existe fora de produção**: com `NODE_ENV=production` a API e o gateway param com erro se o banco ou o Redis não responderem.

Para o web falar com a API local: `VITE_API_URL=http://localhost:3001 VITE_GATEWAY_URL=ws://localhost:3002 pnpm dev:web`.

## Comandos

| Comando | O que faz |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` | TypeScript estrito em api, gateway e web |
| `pnpm db:migrate` | aplica as migrations pendentes (tabela `schema_migrations`, idempotente) |
| `pnpm db:migrate:status` | lista aplicadas `[x]` e pendentes `[ ]` |
| `pnpm db:seed` | seed de desenvolvimento (recusa com `NODE_ENV=production`) |
| `pnpm smoke <url>` | teste de fumaça ponta a ponta contra uma URL (cria e apaga contas de teste) |
| `pnpm deploy` | deploy no servidor (ver abaixo) |

Migrations novas: crie `apps/api/src/db/migrations/NNN_nome.sql`. Cada uma roda numa transação e fica registrada em `schema_migrations`. Bancos antigos, onde as 4 primeiras foram aplicadas na mão com `psql`, são detectados e registrados sem rodar de novo.

## Produção (VM Oracle, 1 GB)

O app roda no usuário `vekrom` em `/home/vekrom/vekrom`:

- **Caddy** (`infra/caddy/Caddyfile` → `/etc/caddy/Caddyfile`):
  - HTTPS automático;
  - `/api/*` → API em `127.0.0.1:3001`;
  - `/ws` → gateway em `127.0.0.1:3002`;
  - `/api/files/*` servido direto de `/home/vekrom/uploads` com cache de 1 ano;
  - `/assets/*` com cache imutável e `index.html` sem cache;
  - zstd/gzip;
  - HSTS, CSP, `nosniff`, `Referrer-Policy`, `X-Frame-Options` e `Permissions-Policy`.
- **systemd**: `vekrom-api` e `vekrom-gateway` (`infra/systemd/`). Escutam só em localhost e têm heap do Node limitado (`--max-old-space-size` 160/96 MB), `MemoryMax` de 350M/200M, sistema de arquivos somente leitura (exceto uploads) e shutdown gracioso no SIGTERM.
- **Postgres** com `infra/postgres/vekrom-1gb.conf` em `conf.d/`: `shared_buffers` 96 MB, `work_mem` 2 MB, `max_connections` 30 e JIT desligado.
- **Redis** com `maxmemory` de 64 MB (`volatile-lru`). Guarda só rate limit e presença, tudo com TTL.
- **`.env`** fica fora do git, na raiz:
  - variáveis obrigatórias em produção: `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` (32+ caracteres), `CORS_ORIGIN` e `PUBLIC_UPLOAD_URL`;
  - opcionais: `UPLOAD_DIR`, `PGPOOL_MAX`, `TURN_URLS` e `TURN_SECRET`.

### Deploy

```bash
ssh vekrom@144.33.6.56
~/vekrom/scripts/deploy.sh
```

O script segue esta ordem:

1. `git pull`;
2. `pnpm install --frozen-lockfile`;
3. migrations;
4. build da API e do gateway;
5. build do web numa pasta nova e troca atômica, mantendo os assets antigos por 14 dias para não quebrar abas abertas;
6. restart dos serviços;
7. checagem do `/health` da API e do gateway.

Depois rode `pnpm smoke https://144-33-6-56.sslip.io` para conferir.

Logs: `sudo journalctl -u vekrom-api -u vekrom-gateway -f`. Saúde: `curl https://144-33-6-56.sslip.io/api/health` (responde 503 se o banco ou o Redis caírem).

### Backup e restauração

O timer `vekrom-backup.timer` roda todo dia às 04h15. Ele faz `pg_dump` do banco e um `tar.gz` dos uploads em `/home/vekrom/backups`, guarda 7 dias e apaga o resto sozinho.

```bash
sudo systemctl start vekrom-backup.service      # backup agora
ls -lh ~/backups                                 # db-AAAAMMDD-HHMM.dump e uploads-AAAAMMDD-HHMM.tar.gz
~/vekrom/scripts/restore.sh ~/backups/db-20261012-0415.dump ~/backups/uploads-20261012-0415.tar.gz
```

`restore.sh` pede confirmação (digite `RESTAURAR`). Depois ele para a API e o gateway, roda `pg_restore --clean` numa transação só, extrai os uploads e sobe tudo de novo. Para guardar fora da VM, copie `~/backups` para outro lugar de tempos em tempos (por exemplo, `scp` ou `rclone` para um bucket).

### TURN (voz)

Sem TURN, a voz funciona entre redes "boas" (STUN). Atrás de 4G, de NAT simétrico ou de rede corporativa, as pessoas não se ouvem. Na VM o coturn já está **instalado, configurado e desligado**:

- a configuração está em `/etc/turnserver.conf`, a partir de `infra/coturn/turnserver.conf`;
- as credenciais são temporárias (REST API secret, HMAC, 6h);
- o coturn bloqueia o acesso à rede interna;
- o segredo já está em `TURN_SECRET` no `.env`.

Para ligar:

1. Libere as portas no painel da Oracle em **Networking → VCN → Security List**: `3478` TCP+UDP e `49160-49200` UDP, com origem `0.0.0.0/0`.
2. Na VM, como root:
   ```bash
   iptables -I INPUT 5 -p udp --dport 3478 -j ACCEPT
   iptables -I INPUT 5 -p tcp --dport 3478 -j ACCEPT
   iptables -I INPUT 5 -p udp --dport 49160:49200 -j ACCEPT
   netfilter-persistent save
   systemctl enable --now coturn
   echo 'TURN_URLS=turn:144.33.6.56:3478?transport=udp,turn:144.33.6.56:3478?transport=tcp' >> /home/vekrom/vekrom/.env
   systemctl restart vekrom-api
   ```
3. Confira: `GET /api/voice/ice` (logado) deve devolver um `iceServers` com `turn:`.

### Domínio próprio

1. Aponte um registro A do domínio para `144.33.6.56`.
2. Troque `144-33-6-56.sslip.io` no `/etc/caddy/Caddyfile` e rode `sudo systemctl reload caddy`. O Caddy emite o certificado sozinho.
3. No `.env`, troque `CORS_ORIGIN` e `PUBLIC_UPLOAD_URL`.
4. Rode `~/vekrom/scripts/deploy.sh`. O web pega a URL do WebSocket do `CORS_ORIGIN`.

## Segurança: o que já está garantido

| Tema | Como está |
| --- | --- |
| Sessão | Access token JWT de 15 min só em memória. O refresh fica em cookie `httpOnly`, `Secure` e `SameSite=Strict`, com rotação a cada uso, e no banco vai só o hash SHA-256. |
| Login | Senha com bcrypt custo 12. O tempo é igual com e sem conta (não revela e-mails). |
| Rate limit | Por IP real (`trustProxy` só para o Caddy local) no login, cadastro e refresh, e por usuário nas mensagens, uploads, convites e amizades. Há ainda um teto global de 600/min por IP. |
| Entradas | Toda rota valida com zod. Ids não numéricos dão 400, não 500. |
| Acesso | Cada rota confere se a pessoa é membro do servidor e tem o cargo certo. Não-membro recebe 404. O gateway só entrega eventos a membros e só deixa entrar na voz e sinalizar quem está no mesmo canal. |
| WebSocket | Token via IDENTIFY (nunca na URL), derrubado quando expira e revalidado a cada renovação. Checa o Origin, faz ping a cada 30s e limita 15 mensagens/s por conexão. |
| Uploads | Imagens, áudio e MP4 de até 8 MB, com MIME pelos bytes (não pela extensão) e nome UUID. `/files` aceita só esse formato (sem path traversal). Anexos e avatares só aceitam URLs do próprio servidor. |
| XSS | O web renderiza markdown como elementos React, sem `innerHTML`. Links só `http(s)`, com `rel=noopener`. |
| Headers | CSP, HSTS, `nosniff`, `Referrer-Policy`, `frame-ancestors 'none'` e sem `Server`. |
| Logs | Pino estruturado, sem `authorization`, cookie ou `set-cookie`. |
| Conta | Exclusão de conta (LGPD) apaga os servidores próprios, as mensagens e as sessões. A troca de senha derruba as outras sessões. |
