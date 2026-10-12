import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHmac } from "node:crypto";
import { pool } from "../plugins/db.js";
import { publish } from "../plugins/redis.js";
import { config } from "../config.js";
import { verifyPassword, hashPassword } from "../plugins/auth.js";
import { limit } from "../services/ratelimit.js";
import { fail, parse, uid, uploadUrl } from "../lib/http.js";
import { USER_COLUMNS, username } from "./auth.js";

const patchMe = z.object({
  username: username.optional(),
  avatarUrl: uploadUrl.nullable().optional(),
  bio: z.string().trim().max(190).nullable().optional(),
  bannerColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});

export async function userRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] };

  app.patch("/users/@me", auth, async (req) => {
    const me = uid(req);
    await limit(`profile:${me}`, 30, 600);
    const body = parse(patchMe, req.body);
    const set: string[] = [];
    const vals: unknown[] = [];
    const cols = { username: "username", avatarUrl: "avatar_url", bio: "bio", bannerColor: "banner_color" } as const;
    for (const [k, col] of Object.entries(cols) as Array<[keyof typeof cols, string]>) {
      if (body[k] !== undefined) {
        vals.push(body[k]);
        set.push(`${col}=$${vals.length}`);
      }
    }
    if (set.length === 0) fail(400, "nothing_to_update");
    vals.push(me);
    try {
      const { rows } = await pool.query(`UPDATE users SET ${set.join(", ")}, updated_at=NOW() WHERE id=$${vals.length} RETURNING ${USER_COLUMNS}`, vals);
      const user = rows[0];
      // Quem divide servidor com ele atualiza nome/avatar ao vivo.
      const servers = await pool.query(`SELECT server_id FROM server_members WHERE user_id=$1 AND status='member'`, [me]);
      for (const s of servers.rows) {
        await publish({ t: "USER_UPDATE", d: { user: { id: user.id, username: user.username, avatarUrl: user.avatarUrl, bio: user.bio, bannerColor: user.bannerColor } }, serverId: String(s.server_id) });
      }
      return { user };
    } catch (e) {
      if ((e as { code?: string }).code === "23505") fail(409, "username_in_use");
      throw e;
    }
  });

  app.post("/users/@me/password", auth, async (req) => {
    const me = uid(req);
    await limit(`password:${me}`, 5, 900);
    const body = parse(z.object({ current: z.string().min(1).max(128), next: z.string().min(8).max(128) }), req.body);
    const { rows } = await pool.query(`SELECT password_hash FROM users WHERE id=$1`, [me]);
    if (!rows[0] || !(await verifyPassword(body.current, rows[0].password_hash))) fail(403, "invalid_password");
    await pool.query(`UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2`, [await hashPassword(body.next), me]);
    // Derruba as outras sessões.
    await pool.query(`DELETE FROM refresh_tokens WHERE user_id=$1`, [me]);
    return { ok: true };
  });

  // Excluir conta (LGPD): apaga servidores próprios, mensagens e o usuário. Pede a senha.
  app.delete("/users/@me", auth, async (req, reply) => {
    const me = uid(req);
    await limit(`delete:${me}`, 5, 900);
    const body = parse(z.object({ password: z.string().min(1).max(128) }), req.body);
    const { rows } = await pool.query(`SELECT password_hash FROM users WHERE id=$1`, [me]);
    if (!rows[0] || !(await verifyPassword(body.password, rows[0].password_hash))) fail(403, "invalid_password");
    const owned = await pool.query(`SELECT id FROM servers WHERE owner_id=$1`, [me]);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM servers WHERE owner_id=$1`, [me]);
      await client.query(`DELETE FROM users WHERE id=$1`, [me]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    for (const s of owned.rows) await publish({ t: "SERVER_DELETE", d: { serverId: String(s.id) }, serverId: String(s.id) });
    reply.clearCookie("refreshToken", { path: config.COOKIE_PATH });
    return { ok: true };
  });

  /**
   * ICE servers para WebRTC. TURN com credencial temporária (coturn use-auth-secret):
   * username = "<expira>:<uid>", credential = base64(HMAC-SHA1(secret, username)).
   */
  app.get("/voice/ice", auth, async (req) => {
    const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [{ urls: "stun:stun.l.google.com:19302" }];
    if (config.TURN_URLS && config.TURN_SECRET) {
      const name = `${Math.floor(Date.now() / 1000) + config.TURN_TTL_SEC}:${uid(req)}`;
      const credential = createHmac("sha1", config.TURN_SECRET).update(name).digest("base64");
      iceServers.push({ urls: config.TURN_URLS.split(",").map((s) => s.trim()), username: name, credential });
    }
    return { iceServers, ttl: config.TURN_TTL_SEC };
  });
}
