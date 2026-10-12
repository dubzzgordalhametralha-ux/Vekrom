import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../plugins/db.js";
import { publish } from "../plugins/redis.js";
import { limit } from "../services/ratelimit.js";
import { PERM, can, channelAccess } from "../lib/access.js";
import { fail, id, messageBody, params, parse, uid } from "../lib/http.js";

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  // cursor = "<createdAt ISO>,<id>" (keyset)
  before: z.string().regex(/^[0-9T:.\-+Z]{10,40},\d{1,18}$/).optional(),
});
const emojiBody = z.object({ emoji: z.string().min(1).max(16) });

const SELECT = `SELECT m.id, m.channel_id AS "channelId", m.author_id AS "authorId", m.content, m.attachments,
                m.created_at AS "createdAt", m.edited_at AS "editedAt",
                u.username AS a_username, u.avatar_url AS a_avatar
         FROM messages m JOIN users u ON u.id=m.author_id`;

type Row = Record<string, unknown>;
type Reaction = { emoji: string; count: number; me: boolean };

export function toMessage(r: Row, reactions: Reaction[] = []) {
  return {
    id: String(r.id),
    channelId: String(r.channelId),
    authorId: String(r.authorId),
    content: r.content as string,
    attachments: (typeof r.attachments === "string" ? JSON.parse(r.attachments) : r.attachments) ?? [],
    createdAt: new Date(r.createdAt as string).toISOString(),
    editedAt: r.editedAt ? new Date(r.editedAt as string).toISOString() : null,
    author: { id: String(r.authorId), username: r.a_username as string, avatarUrl: (r.a_avatar as string | null) ?? null },
    reactions,
  };
}

async function reactionsFor(messageIds: string[], me: string): Promise<Map<string, Reaction[]>> {
  const out = new Map<string, Reaction[]>();
  if (messageIds.length === 0) return out;
  const { rows } = await pool.query(`SELECT message_id, emoji, user_id FROM reactions WHERE message_id = ANY($1::bigint[])`, [messageIds]);
  for (const r of rows) {
    const list = out.get(String(r.message_id)) ?? [];
    const item = list.find((x) => x.emoji === r.emoji) ?? (list.push({ emoji: r.emoji, count: 0, me: false }), list[list.length - 1]);
    item.count++;
    if (String(r.user_id) === me) item.me = true;
    out.set(String(r.message_id), list);
  }
  return out;
}

async function messageWithAccess(messageId: string, me: string) {
  const { rows } = await pool.query(`${SELECT} WHERE m.id=$1`, [messageId]);
  if (!rows[0]) fail(404, "not_found");
  const access = await channelAccess(String(rows[0].channelId), me);
  if (!access) fail(404, "not_found");
  return { row: rows[0], access };
}

export async function messageRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] };

  app.get("/channels/:id/messages", auth, async (req) => {
    const me = uid(req);
    const { id: channelId } = parse(params.id, req.params);
    if (!(await channelAccess(channelId, me))) fail(404, "channel_not_found");
    const q = parse(listQuery, req.query);
    let rows;
    if (q.before) {
      const [ts, mid] = q.before.split(",");
      ({ rows } = await pool.query(
        `${SELECT} WHERE m.channel_id=$1 AND (m.created_at < $2 OR (m.created_at = $2 AND m.id < $3::bigint))
         ORDER BY m.created_at DESC, m.id DESC LIMIT $4`,
        [channelId, ts, mid, q.limit],
      ));
    } else {
      ({ rows } = await pool.query(`${SELECT} WHERE m.channel_id=$1 ORDER BY m.created_at DESC, m.id DESC LIMIT $2`, [channelId, q.limit]));
    }
    const reactions = await reactionsFor(rows.map((r) => String(r.id)), me);
    const items = rows.map((r) => toMessage(r, reactions.get(String(r.id))));
    const last = items[items.length - 1];
    return { items: items.reverse(), nextCursor: items.length === q.limit && last ? `${last.createdAt},${last.id}` : null };
  });

  app.post("/channels/:id/messages", auth, async (req) => {
    const me = uid(req);
    const { id: channelId } = parse(params.id, req.params);
    const access = await channelAccess(channelId, me);
    if (!access || access.channel.type === "voice") fail(404, "channel_not_found");
    await limit(`msg:${me}`, 10, 10);
    await limit(`msg:min:${me}`, 60, 60);
    const body = parse(messageBody, req.body);
    const ins = await pool.query(
      `INSERT INTO messages (channel_id, author_id, content, attachments) VALUES ($1,$2,$3,$4) RETURNING id`,
      [channelId, me, body.content, JSON.stringify(body.attachments)],
    );
    const { rows } = await pool.query(`${SELECT} WHERE m.id=$1`, [ins.rows[0].id]);
    const message = toMessage(rows[0]);
    await publish({ t: "MESSAGE_CREATE", d: { message, serverId: access.channel.serverId }, serverId: access.channel.serverId });
    return { message };
  });

  app.patch("/messages/:id", auth, async (req) => {
    const me = uid(req);
    const { id: messageId } = parse(params.id, req.params);
    const { row, access } = await messageWithAccess(messageId, me);
    if (String(row.authorId) !== me) fail(403, "not_author");
    const body = parse(messageBody, req.body);
    await pool.query(`UPDATE messages SET content=$1, edited_at=NOW() WHERE id=$2`, [body.content, messageId]);
    const { rows } = await pool.query(`${SELECT} WHERE m.id=$1`, [messageId]);
    const message = toMessage(rows[0], (await reactionsFor([messageId], me)).get(messageId));
    await publish({ t: "MESSAGE_UPDATE", d: { message }, serverId: access.channel.serverId });
    return { message };
  });

  app.delete("/messages/:id", auth, async (req) => {
    const me = uid(req);
    const { id: messageId } = parse(params.id, req.params);
    const { row, access } = await messageWithAccess(messageId, me);
    if (String(row.authorId) !== me && !can(access.m, PERM.MANAGE_MESSAGES)) fail(403, "missing_permission");
    await pool.query(`DELETE FROM messages WHERE id=$1`, [messageId]);
    await publish({ t: "MESSAGE_DELETE", d: { id: messageId, channelId: String(row.channelId) }, serverId: access.channel.serverId });
    return { ok: true };
  });

  // Reações: PUT adiciona, DELETE remove a minha.
  for (const method of ["PUT", "DELETE"] as const) {
    app.route({
      method,
      url: "/messages/:id/reactions",
      preHandler: [app.authenticate],
      handler: async (req) => {
        const me = uid(req);
        const { id: messageId } = parse(z.object({ id }), req.params);
        const { emoji } = parse(emojiBody, req.body ?? req.query);
        const { row, access } = await messageWithAccess(messageId, me);
        await limit(`react:${me}`, 30, 10);
        if (method === "PUT") {
          await pool.query(`INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [messageId, me, emoji]);
        } else {
          await pool.query(`DELETE FROM reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3`, [messageId, me, emoji]);
        }
        const { rows } = await pool.query(`SELECT emoji, COUNT(*)::int AS count FROM reactions WHERE message_id=$1 GROUP BY emoji`, [messageId]);
        await publish({
          t: "REACTION_UPDATE",
          d: { messageId, channelId: String(row.channelId), reactions: rows, userId: me, emoji, added: method === "PUT" },
          serverId: access.channel.serverId,
        });
        return { ok: true };
      },
    });
  }
}
