-- Vekrom canonical schema (Postgres 16)
-- Usado só pelo modo pg-mem (dev). Produção: migrations/ + `pnpm db:migrate`.
-- migrations/001_init.sql deve espelhar este arquivo.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------- users
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      VARCHAR(32)  NOT NULL,
  discriminator VARCHAR(4)   NOT NULL DEFAULT '0000',
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,
  avatar_url    TEXT,
  bot           BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

-- ---------------------------------------------------------------- servers
CREATE TABLE IF NOT EXISTS servers (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  icon_url   TEXT,
  owner_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_servers_owner ON servers (owner_id);

-- ---------------------------------------------------------------- server_members
CREATE TABLE IF NOT EXISTS server_members (
  server_id BIGINT      NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id   BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname  VARCHAR(32),
  status    TEXT        NOT NULL DEFAULT 'member' CHECK (status IN ('member','pending','banned')),
  voice_muted BOOLEAN NOT NULL DEFAULT FALSE,
  sound_muted BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (server_id, user_id)
);
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS voice_muted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS sound_muted BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_server_members_user ON server_members (user_id);

-- ---------------------------------------------------------------- roles
CREATE TABLE IF NOT EXISTS roles (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  server_id   BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name        VARCHAR(50) NOT NULL,
  permissions INTEGER NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0,
  color       INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_roles_server ON roles (server_id);

-- member <-> role (muitos-para-muitos, faltava no plano; necessário p/ perms)
CREATE TABLE IF NOT EXISTS member_roles (
  server_id BIGINT NOT NULL,
  user_id   BIGINT NOT NULL,
  role_id   BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (server_id, user_id, role_id),
  FOREIGN KEY (server_id, user_id) REFERENCES server_members(server_id, user_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------- channels
CREATE TABLE IF NOT EXISTS channels (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  server_id  BIGINT REFERENCES servers(id) ON DELETE CASCADE, -- NULL => DM
  name       VARCHAR(100) NOT NULL,
  type       TEXT NOT NULL DEFAULT 'text'
             CHECK (type IN ('text','voice','announcement','dm','group_dm')),
  topic      TEXT,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_channels_server ON channels (server_id);

-- ---------------------------------------------------------------- messages
CREATE TABLE IF NOT EXISTS messages (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel_id  BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     VARCHAR(2000) NOT NULL DEFAULT '',
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  edited_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Índice quente do plano: paginação por canal
CREATE INDEX IF NOT EXISTS idx_messages_channel_created_id
  ON messages (channel_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_messages_author ON messages (author_id);

-- ---------------------------------------------------------------- direct_messages
CREATE TABLE IF NOT EXISTS direct_messages (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sender_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content      VARCHAR(2000) NOT NULL DEFAULT '',
  attachments  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (sender_id <> recipient_id)
);
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_dm_pair_created
  ON direct_messages (sender_id, recipient_id, created_at DESC, id DESC);

-- ---------------------------------------------------------------- friendships
CREATE TABLE IF NOT EXISTS friendships (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  requester_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','accepted','blocked')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships (addressee_id);

-- ---------------------------------------------------------------- refresh_tokens (refresh rotativo httpOnly)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT   NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);

-- ---------------------------------------------------------------- reactions
CREATE TABLE IF NOT EXISTS reactions (
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      VARCHAR(16) NOT NULL DEFAULT '👍',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions (message_id);

-- ---------------------------------------------------------------- 004 (perfil, convites, índices)
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
