import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../plugins/db.js";
import { publish, presenceOf } from "../plugins/redis.js";
import { limit } from "../services/ratelimit.js";
import { canDirectMessage } from "../lib/access.js";
import { fail, messageBody, params, parse, uid } from "../lib/http.js";
import { username } from "./auth.js";

const dmQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().regex(/^[0-9T:.\-+Z]{10,40},\d{1,18}$/).optional(),
});

const DM_SELECT = `SELECT d.id, d.sender_id AS "senderId", d.recipient_id AS "recipientId", d.content, d.attachments,
                  d.created_at AS "createdAt", u.username AS a_username, u.avatar_url AS a_avatar
                  FROM direct_messages d JOIN users u ON u.id=d.sender_id`;

function toDm(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    senderId: String(r.senderId),
    recipientId: String(r.recipientId),
    content: r.content as string,
    attachments: (typeof r.attachments === "string" ? JSON.parse(r.attachments) : r.attachments) ?? [],
    createdAt: new Date(r.createdAt as string).toISOString(),
    author: { id: String(r.senderId), username: r.a_username as string, avatarUrl: (r.a_avatar as string | null) ?? null },
  };
}

const PUBLIC_USER = `id, username, avatar_url AS "avatarUrl", bio, banner_color AS "bannerColor", created_at AS "createdAt"`;

export async function socialRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] };

  // ---- friends ----
  app.get("/friends", auth, async (req) => {
    const me = uid(req);
    const { rows } = await pool.query(
      `SELECT f.id AS fid, f.status, f.requester_id, u.id, u.username, u.avatar_url AS "avatarUrl", u.bio
       FROM friendships f JOIN users u ON u.id = CASE WHEN f.requester_id=$1 THEN f.addressee_id ELSE f.requester_id END
       WHERE (f.requester_id=$1 OR f.addressee_id=$1) AND f.status <> 'blocked' ORDER BY LOWER(u.username)`,
      [me],
    );
    const presence = await presenceOf(rows.map((r) => String(r.id)));
    return {
      friends: rows.map((r) => ({
        id: String(r.fid),
        status: r.status,
        direction: String(r.requester_id) === me ? "outgoing" : "incoming",
        user: { id: String(r.id), username: r.username, avatarUrl: r.avatarUrl, bio: r.bio, status: r.status === "accepted" ? presence[String(r.id)] : "offline" },
      })),
    };
  });

  app.post("/friends", auth, async (req) => {
    const me = uid(req);
    await limit(`friend:${me}`, 30, 3600);
    const body = parse(z.object({ username }), req.body);
    const target = await pool.query(`SELECT id FROM users WHERE LOWER(username)=LOWER($1)`, [body.username]);
    const other = target.rows[0] ? String(target.rows[0].id) : null;
    if (!other) fail(404, "user_not_found");
    if (other === me) fail(400, "cannot_add_self");
    const existing = await pool.query(
      `SELECT id, status, requester_id FROM friendships WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)`,
      [me, other],
    );
    const ex = existing.rows[0];
    if (ex?.status === "blocked") fail(403, "blocked");
    if (ex?.status === "accepted") fail(409, "already_friends");
    if (ex && String(ex.requester_id) === me) fail(409, "already_requested");
    if (ex) {
      // Ele já tinha pedido: aceitar.
      await pool.query(`UPDATE friendships SET status='accepted', updated_at=NOW() WHERE id=$1`, [ex.id]);
    } else {
      await pool.query(`INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1,$2,'pending')`, [me, other]);
    }
    await publish({ t: "FRIEND_UPDATE", d: {}, userIds: [me, other] });
    return { ok: true, accepted: Boolean(ex) };
  });

  app.post("/friends/:id/accept", auth, async (req) => {
    const me = uid(req);
    const { id } = parse(params.id, req.params);
    const { rows } = await pool.query(
      `UPDATE friendships SET status='accepted', updated_at=NOW() WHERE id=$1 AND addressee_id=$2 AND status='pending' RETURNING requester_id`,
      [id, me],
    );
    if (!rows[0]) fail(404, "request_not_found");
    await publish({ t: "FRIEND_UPDATE", d: {}, userIds: [me, String(rows[0].requester_id)] });
    return { ok: true };
  });

  app.delete("/friends/:id", auth, async (req) => {
    const me = uid(req);
    const { id } = parse(params.id, req.params);
    const { rows } = await pool.query(
      `DELETE FROM friendships WHERE id=$1 AND (requester_id=$2 OR addressee_id=$2) AND status <> 'blocked' RETURNING requester_id, addressee_id`,
      [id, me],
    );
    if (!rows[0]) fail(404, "not_found");
    await publish({ t: "FRIEND_UPDATE", d: {}, userIds: [String(rows[0].requester_id), String(rows[0].addressee_id)] });
    return { ok: true };
  });

  // ---- users ----
  app.get("/users/:userId", auth, async (req) => {
    const { userId } = parse(params.userId, req.params);
    const { rows } = await pool.query(`SELECT ${PUBLIC_USER} FROM users WHERE id=$1`, [userId]);
    if (!rows[0]) fail(404, "user_not_found");
    const presence = await presenceOf([userId]);
    return { user: { ...rows[0], status: presence[userId] } };
  });

  // ---- DMs ----
  app.get("/dms", auth, async (req) => {
    const me = uid(req);
    // ponytail: varre as 500 DMs mais recentes; vira DISTINCT ON/tabela de conversas se alguém tiver centenas de conversas.
    const { rows } = await pool.query(
      `SELECT id, sender_id, recipient_id, content, created_at FROM direct_messages
       WHERE sender_id=$1 OR recipient_id=$1 ORDER BY created_at DESC LIMIT 500`,
      [me],
    );
    const seen = new Map<string, { lastMessage: string; lastAt: string }>();
    for (const r of rows) {
      const other = String(r.sender_id) === me ? String(r.recipient_id) : String(r.sender_id);
      if (!seen.has(other)) seen.set(other, { lastMessage: r.content, lastAt: new Date(r.created_at).toISOString() });
    }
    const ids = [...seen.keys()];
    if (ids.length === 0) return { conversations: [] };
    const users = await pool.query(`SELECT id, username, avatar_url AS "avatarUrl" FROM users WHERE id = ANY($1::bigint[])`, [ids]);
    const presence = await presenceOf(ids);
    const byId = new Map(users.rows.map((u) => [String(u.id), u]));
    return {
      conversations: ids
        .filter((i) => byId.has(i))
        .map((i) => ({ user: { ...byId.get(i), id: i, status: presence[i] }, ...seen.get(i)! })),
    };
  });

  app.get("/dms/:userId/messages", auth, async (req) => {
    const me = uid(req);
    const { userId: other } = parse(params.userId, req.params);
    const q = parse(dmQuery, req.query);
    const pair = `((d.sender_id=$1 AND d.recipient_id=$2) OR (d.sender_id=$2 AND d.recipient_id=$1))`;
    let rows;
    if (q.before) {
      const [ts, mid] = q.before.split(",");
      ({ rows } = await pool.query(
        `${DM_SELECT} WHERE ${pair} AND (d.created_at < $3 OR (d.created_at = $3 AND d.id < $4::bigint)) ORDER BY d.created_at DESC, d.id DESC LIMIT $5`,
        [me, other, ts, mid, q.limit],
      ));
    } else {
      ({ rows } = await pool.query(`${DM_SELECT} WHERE ${pair} ORDER BY d.created_at DESC, d.id DESC LIMIT $3`, [me, other, q.limit]));
    }
    const items = rows.map(toDm);
    const last = items[items.length - 1];
    return { items: items.reverse(), nextCursor: items.length === q.limit && last ? `${last.createdAt},${last.id}` : null };
  });

  app.post("/dms/:userId/messages", auth, async (req) => {
    const me = uid(req);
    const { userId: other } = parse(params.userId, req.params);
    await limit(`msg:${me}`, 10, 10);
    await limit(`msg:min:${me}`, 60, 60);
    const body = parse(messageBody, req.body);
    if (!(await canDirectMessage(me, other))) fail(403, "cannot_dm");
    const ins = await pool.query(
      `INSERT INTO direct_messages (sender_id, recipient_id, content, attachments) VALUES ($1,$2,$3,$4) RETURNING id`,
      [me, other, body.content, JSON.stringify(body.attachments)],
    );
    const { rows } = await pool.query(`${DM_SELECT} WHERE d.id=$1`, [ins.rows[0].id]);
    const message = toDm(rows[0]);
    await publish({ t: "DM_CREATE", d: { message }, userIds: [me, other] });
    return { message };
  });
}
