-- 004_prod_ready.sql — perfil, convites, nomes únicos e índices de produção

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS bio          VARCHAR(190),
  ADD COLUMN IF NOT EXISTS banner_color VARCHAR(7);

-- Nome de usuário vira identificador único (sem diferenciar maiúsculas), como no Discord atual.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_lower ON users (LOWER(username));

CREATE TABLE IF NOT EXISTS invites (
  code       VARCHAR(16) PRIMARY KEY,
  server_id  BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  uses       INTEGER NOT NULL DEFAULT 0,
  max_uses   INTEGER,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invites_server ON invites (server_id);

CREATE INDEX IF NOT EXISTS idx_dm_recipient_created ON direct_messages (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens (expires_at);

-- Bits de permissão novos (ver apps/api/src/lib/access.ts): admin = 1, @everyone = 0.
UPDATE roles SET permissions = 0 WHERE name = '@everyone';
