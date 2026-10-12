-- seed.sql — dados de desenvolvimento (NUNCA rode em produção; `pnpm db:seed` recusa com NODE_ENV=production)
-- Usuários: alice@example.com / bob@example.com, senha: password123
-- Sem ids fixos: as colunas são GENERATED ALWAYS AS IDENTITY.

WITH a AS (
  INSERT INTO users (username, discriminator, email, password_hash)
  VALUES ('alice', '0001', 'alice@example.com', '$2a$10$eBWK2sz2rncK2OKB6U0td.TFJWTq0QbUW6uDZPLX6E0NWOUF34sFe')
  ON CONFLICT (email) DO UPDATE SET username = EXCLUDED.username
  RETURNING id
), b AS (
  INSERT INTO users (username, discriminator, email, password_hash)
  VALUES ('bob', '0002', 'bob@example.com', '$2a$10$eBWK2sz2rncK2OKB6U0td.TFJWTq0QbUW6uDZPLX6E0NWOUF34sFe')
  ON CONFLICT (email) DO UPDATE SET username = EXCLUDED.username
  RETURNING id
), s AS (
  INSERT INTO servers (name, owner_id) SELECT 'Vekrom HQ', a.id FROM a
  WHERE NOT EXISTS (SELECT 1 FROM servers WHERE name = 'Vekrom HQ')  -- idempotente
  RETURNING id, owner_id
), m AS (
  INSERT INTO server_members (server_id, user_id, status)
  SELECT s.id, a.id, 'member' FROM s, a UNION ALL SELECT s.id, b.id, 'member' FROM s, b
  RETURNING server_id
), r AS (
  INSERT INTO roles (server_id, name, permissions, position, color)
  SELECT s.id, 'admin', 1, 100, 16733530 FROM s UNION ALL SELECT s.id, '@everyone', 0, 0, NULL FROM s
  RETURNING id
), c AS (
  INSERT INTO channels (server_id, name, type, topic, position)
  SELECT s.id, 'geral', 'text', 'Conversa geral', 0 FROM s
  UNION ALL SELECT s.id, 'random', 'text', 'Off-topic', 1 FROM s
  UNION ALL SELECT s.id, 'Voz Geral', 'voice', NULL, 2 FROM s
  RETURNING id, name
), msg AS (
  INSERT INTO messages (channel_id, author_id, content)
  SELECT c.id, a.id, 'Bem-vindos ao Vekrom!' FROM c, a WHERE c.name = 'geral'
  UNION ALL SELECT c.id, b.id, 'Opa! Tudo certo por aqui.' FROM c, b WHERE c.name = 'geral'
  RETURNING id
), f AS (
  INSERT INTO friendships (requester_id, addressee_id, status)
  SELECT a.id, b.id, 'accepted' FROM a, b
  ON CONFLICT (requester_id, addressee_id) DO UPDATE SET status = 'accepted'
  RETURNING id
)
INSERT INTO direct_messages (sender_id, recipient_id, content)
SELECT a.id, b.id, 'E aí, testando DM!' FROM a, b WHERE EXISTS (SELECT 1 FROM s);
