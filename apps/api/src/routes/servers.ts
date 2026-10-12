import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { pool } from "../plugins/db.js";
import { publish, presenceOf } from "../plugins/redis.js";
import { limit } from "../services/ratelimit.js";
import { PERM, can, membership, channelAccess, type Membership } from "../lib/access.js";
import { fail, params, parse, uid, uploadUrl } from "../lib/http.js";

const SERVER_COLS = `s.id, s.name, s.icon_url AS "iconUrl", s.owner_id AS "ownerId", s.created_at AS "createdAt"`;
const CHANNEL_COLS = `id, server_id AS "serverId", name, type, topic, position`;

const serverName = z.string().trim().min(1).max(100);
const serverCreate = z.object({ name: serverName, iconUrl: uploadUrl.nullable().optional() });
const serverPatch = z.object({ name: serverName.optional(), iconUrl: uploadUrl.nullable().optional() });
const channelName = z.string().trim().min(1).max(100);
const channelCreate = z.object({ name: channelName, type: z.enum(["text", "voice", "announcement"]).default("text"), topic: z.string().trim().max(1024).nullable().optional() });
const channelPatch = z.object({ name: channelName.optional(), topic: z.string().trim().max(1024).nullable().optional() });
const inviteCreate = z.object({ maxUses: z.number().int().min(1).max(1000).nullable().optional(), expiresInHours: z.number().int().min(1).max(24 * 30).nullable().optional() });
const roleBody = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  permissions: z.number().int().min(0).max(2 ** 30).optional(),
  color: z.number().int().min(0).max(0xffffff).nullable().optional(),
});
const moderation = z.object({ action: z.enum(["kick", "ban", "voice_mute", "sound_mute"]), enabled: z.boolean().default(true) });
const MOD_BITS = { kick: PERM.KICK_MEMBERS, ban: PERM.BAN_MEMBERS, voice_mute: PERM.MUTE_MEMBERS, sound_mute: PERM.DEAFEN_MEMBERS } as const;

/** Texto vira slug estilo Discord; voz mantém o nome. */
function normalizeChannelName(name: string, type: string): string {
  if (type === "voice") return name;
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 100) || "canal";
}

async function requireMember(serverId: string, userId: string): Promise<Membership> {
  const m = await membership(serverId, userId);
  if (!m) fail(404, "server_not_found");
  return m;
}

function requirePerm(m: Membership, bit: number) {
  if (!can(m, bit)) fail(403, "missing_permission");
}

export async function serverRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] };

  // ---- servers ----
  app.get("/servers", auth, async (req) => {
    const me = uid(req);
    const { rows } = await pool.query(
      `SELECT ${SERVER_COLS} FROM servers s JOIN server_members m ON m.server_id=s.id
       WHERE m.user_id=$1 AND m.status='member' ORDER BY m.joined_at`,
      [me],
    );
    const servers = await Promise.all(rows.map(async (s) => ({ ...s, permissions: (await membership(String(s.id), me))?.perms ?? 0 })));
    return { servers };
  });

  app.post("/servers", auth, async (req) => {
    const me = uid(req);
    await limit(`server:create:${me}`, 10, 3600);
    const body = parse(serverCreate, req.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const s = await client.query(
        `INSERT INTO servers (name, owner_id, icon_url) VALUES ($1,$2,$3) RETURNING id, name, icon_url AS "iconUrl", owner_id AS "ownerId", created_at AS "createdAt"`,
        [body.name, me, body.iconUrl ?? null],
      );
      const sid = s.rows[0].id;
      await client.query(`INSERT INTO server_members (server_id, user_id, status) VALUES ($1,$2,'member')`, [sid, me]);
      await client.query(`INSERT INTO channels (server_id, name, type, position) VALUES ($1,'geral','text',0),($1,'Voz Geral','voice',1)`, [sid]);
      await client.query(`INSERT INTO roles (server_id, name, permissions, position) VALUES ($1,'@everyone',0,0)`, [sid]);
      await client.query("COMMIT");
      const server = { ...s.rows[0], permissions: (await membership(String(sid), me))!.perms };
      await publish({ t: "SERVER_CREATE", d: { server }, userIds: [me], addMember: me, serverId: String(sid) });
      return { server };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  });

  app.get("/servers/:id", auth, async (req) => {
    const { id } = parse(params.id, req.params);
    const m = await requireMember(id, uid(req));
    const { rows } = await pool.query(`SELECT ${SERVER_COLS} FROM servers s WHERE s.id=$1`, [id]);
    return { server: { ...rows[0], permissions: m.perms } };
  });

  app.patch("/servers/:id", auth, async (req) => {
    const { id } = parse(params.id, req.params);
    requirePerm(await requireMember(id, uid(req)), PERM.MANAGE_SERVER);
    const body = parse(serverPatch, req.body);
    const { rows } = await pool.query(
      `UPDATE servers SET name=COALESCE($1,name), icon_url=CASE WHEN $2::boolean THEN $3 ELSE icon_url END, updated_at=NOW()
       WHERE id=$4 RETURNING id, name, icon_url AS "iconUrl", owner_id AS "ownerId", created_at AS "createdAt"`,
      [body.name ?? null, body.iconUrl !== undefined, body.iconUrl ?? null, id],
    );
    await publish({ t: "SERVER_UPDATE", d: { server: rows[0] }, serverId: id });
    return { server: rows[0] };
  });

  app.delete("/servers/:id", auth, async (req) => {
    const { id } = parse(params.id, req.params);
    const m = await requireMember(id, uid(req));
    if (!m.isOwner) fail(403, "owner_only");
    await publish({ t: "SERVER_DELETE", d: { serverId: id }, serverId: id });
    await pool.query(`DELETE FROM servers WHERE id=$1`, [id]);
    return { ok: true };
  });

  app.post("/servers/:id/leave", auth, async (req) => {
    const { id } = parse(params.id, req.params);
    const me = uid(req);
    const m = await requireMember(id, me);
    if (m.isOwner) fail(400, "owner_cannot_leave");
    await pool.query(`DELETE FROM server_members WHERE server_id=$1 AND user_id=$2`, [id, me]);
    await publish({ t: "MEMBER_LEAVE", d: { serverId: id, userId: me }, serverId: id, removeMember: me });
    return { ok: true };
  });

  // ---- channels ----
  app.get("/servers/:id/channels", auth, async (req) => {
    const { id } = parse(params.id, req.params);
    await requireMember(id, uid(req));
    const { rows } = await pool.query(`SELECT ${CHANNEL_COLS} FROM channels WHERE server_id=$1 ORDER BY position, id`, [id]);
    return { channels: rows };
  });

  app.post("/servers/:id/channels", auth, async (req) => {
    const { id } = parse(params.id, req.params);
    requirePerm(await requireMember(id, uid(req)), PERM.MANAGE_CHANNELS);
    const body = parse(channelCreate, req.body);
    const count = await pool.query(`SELECT COUNT(*)::int AS n FROM channels WHERE server_id=$1`, [id]);
    if (Number(count.rows[0].n) >= 200) fail(400, "too_many_channels");
    const { rows } = await pool.query(
      `INSERT INTO channels (server_id, name, type, topic, position)
       VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(position),-1)+1 FROM channels WHERE server_id=$1)) RETURNING ${CHANNEL_COLS}`,
      [id, normalizeChannelName(body.name, body.type), body.type, body.topic ?? null],
    );
    await publish({ t: "CHANNEL_CREATE", d: { channel: rows[0] }, serverId: id });
    return { channel: rows[0] };
  });

  app.patch("/channels/:id", auth, async (req) => {
    const { id } = parse(params.id, req.params);
    const access = await channelAccess(id, uid(req));
    if (!access) fail(404, "channel_not_found");
    requirePerm(access.m, PERM.MANAGE_CHANNELS);
    const body = parse(channelPatch, req.body);
    const { rows } = await pool.query(
      `UPDATE channels SET name=COALESCE($1,name), topic=CASE WHEN $2::boolean THEN $3 ELSE topic END, updated_at=NOW()
       WHERE id=$4 RETURNING ${CHANNEL_COLS}`,
      [body.name ? normalizeChannelName(body.name, access.channel.type) : null, body.topic !== undefined, body.topic ?? null, id],
    );
    await publish({ t: "CHANNEL_UPDATE", d: { channel: rows[0] }, serverId: access.channel.serverId });
    return { channel: rows[0] };
  });

  app.delete("/channels/:id", auth, async (req) => {
    const { id } = parse(params.id, req.params);
    const access = await channelAccess(id, uid(req));
    if (!access) fail(404, "channel_not_found");
    requirePerm(access.m, PERM.MANAGE_CHANNELS);
    await pool.query(`DELETE FROM channels WHERE id=$1`, [id]);
    await publish({ t: "CHANNEL_DELETE", d: { channelId: id, serverId: access.channel.serverId }, serverId: access.channel.serverId });
    return { ok: true };
  });

  // ---- members ----
  app.get("/servers/:id/members", auth, async (req) => {
    const { id } = parse(params.id, req.params);
    await requireMember(id, uid(req));
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.avatar_url AS "avatarUrl", u.bio, u.banner_color AS "bannerColor", m.nickname, m.joined_at AS "joinedAt",
              m.voice_muted AS "voiceMuted", m.sound_muted AS "soundMuted"
       FROM server_members m JOIN users u ON u.id=m.user_id
       WHERE m.server_id=$1 AND m.status='member' ORDER BY LOWER(u.username) LIMIT 1000`,
      [id],
    );
    const roles = await pool.query(`SELECT user_id, role_id FROM member_roles WHERE server_id=$1`, [id]);
    const byUser = new Map<string, string[]>();
    for (const r of roles.rows) byUser.set(String(r.user_id), [...(byUser.get(String(r.user_id)) ?? []), String(r.role_id)]);
    const presence = await presenceOf(rows.map((r) => String(r.id)));
    return { members: rows.map((r) => ({ ...r, roleIds: byUser.get(String(r.id)) ?? [], status: presence[String(r.id)] })) };
  });

  app.post("/servers/:id/members/:memberId/moderation", auth, async (req) => {
    const { id, memberId } = parse(params.serverMember, req.params);
    const me = uid(req);
    const m = await requireMember(id, me);
    const { action, enabled } = parse(moderation, req.body);
    requirePerm(m, MOD_BITS[action]);
    if (memberId === me) fail(400, "cannot_moderate_self");
    if (memberId === m.ownerId) fail(403, "cannot_moderate_owner");
    const target = await membership(id, memberId);
    if (!target) fail(404, "member_not_found");
    // Só o dono modera quem também tem poder de moderação.
    if (!m.isOwner && target.perms & (PERM.ADMINISTRATOR | MOD_BITS[action])) fail(403, "target_is_moderator");

    if (action === "kick" || action === "ban") {
      if (action === "kick") await pool.query(`DELETE FROM server_members WHERE server_id=$1 AND user_id=$2`, [id, memberId]);
      else await pool.query(`UPDATE server_members SET status='banned' WHERE server_id=$1 AND user_id=$2`, [id, memberId]);
      await pool.query(`DELETE FROM member_roles WHERE server_id=$1 AND user_id=$2`, [id, memberId]);
      await publish({ t: "MEMBER_LEAVE", d: { serverId: id, userId: memberId, reason: action }, serverId: id, removeMember: memberId });
    } else {
      const column = action === "voice_mute" ? "voice_muted" : "sound_muted";
      await pool.query(`UPDATE server_members SET ${column}=$1 WHERE server_id=$2 AND user_id=$3`, [enabled, id, memberId]);
      await publish({
        t: "VOICE_MODERATION",
        d: { userId: memberId, serverId: id, voiceMuted: action === "voice_mute" ? enabled : undefined, soundMuted: action === "sound_mute" ? enabled : undefined },
        serverId: id,
      });
    }
    return { ok: true, action, enabled };
  });

  // ---- invites ----
  app.post("/servers/:id/invites", auth, async (req) => {
    const { id } = parse(params.id, req.params);
    const me = uid(req);
    await requireMember(id, me);
    await limit(`invite:${me}`, 30, 3600);
    const body = parse(inviteCreate, req.body);
    const code = randomBytes(12).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 10);
    const hours = body.expiresInHours === undefined ? 24 * 7 : body.expiresInHours;
    const { rows } = await pool.query(
      `INSERT INTO invites (code, server_id, created_by, max_uses, expires_at) VALUES ($1,$2,$3,$4,$5)
       RETURNING code, max_uses AS "maxUses", expires_at AS "expiresAt"`,
      [code, id, me, body.maxUses ?? null, hours === null ? null : new Date(Date.now() + hours * 3_600_000)],
    );
    return { invite: rows[0] };
  });

  async function findInvite(code: string) {
    const { rows } = await pool.query(
      `SELECT i.code, i.server_id, i.uses, i.max_uses, i.expires_at, s.name, s.icon_url AS "iconUrl",
              (SELECT COUNT(*)::int FROM server_members WHERE server_id=s.id AND status='member') AS "memberCount"
       FROM invites i JOIN servers s ON s.id=i.server_id WHERE i.code=$1`,
      [code],
    );
    const inv = rows[0];
    if (!inv || (inv.expires_at && new Date(inv.expires_at) < new Date()) || (inv.max_uses && inv.uses >= inv.max_uses)) fail(404, "invite_invalid");
    return inv;
  }

  app.get("/invites/:code", auth, async (req) => {
    const { code } = parse(params.code, req.params);
    await limit(`invite:view:${req.ip}`, 60, 600);
    const inv = await findInvite(code);
    return { invite: { code: inv.code, server: { id: String(inv.server_id), name: inv.name, iconUrl: inv.iconUrl, memberCount: Number(inv.memberCount) } } };
  });

  app.post("/invites/:code/join", auth, async (req) => {
    const { code } = parse(params.code, req.params);
    const me = uid(req);
    await limit(`invite:join:${me}`, 20, 3600);
    const inv = await findInvite(code);
    const serverId = String(inv.server_id);
    const existing = await pool.query(`SELECT status FROM server_members WHERE server_id=$1 AND user_id=$2`, [serverId, me]);
    if (existing.rows[0]?.status === "banned") fail(403, "banned_from_server");
    if (existing.rows[0]?.status !== "member") {
      await pool.query(
        `INSERT INTO server_members (server_id, user_id, status) VALUES ($1,$2,'member')
         ON CONFLICT (server_id, user_id) DO UPDATE SET status='member'`,
        [serverId, me],
      );
      await pool.query(`UPDATE invites SET uses=uses+1 WHERE code=$1`, [code]);
      const u = await pool.query(`SELECT id, username, avatar_url AS "avatarUrl" FROM users WHERE id=$1`, [me]);
      await publish({ t: "MEMBER_JOIN", d: { serverId, member: { ...u.rows[0], roleIds: [], status: "online" } }, serverId, addMember: me });
    }
    const { rows } = await pool.query(`SELECT ${SERVER_COLS} FROM servers s WHERE s.id=$1`, [serverId]);
    return { server: { ...rows[0], permissions: (await membership(serverId, me))?.perms ?? 0 } };
  });

  // ---- roles ----
  app.get("/servers/:id/roles", auth, async (req) => {
    const { id } = parse(params.id, req.params);
    await requireMember(id, uid(req));
    const { rows } = await pool.query(
      `SELECT id, server_id AS "serverId", name, permissions, position, color FROM roles WHERE server_id=$1 ORDER BY position DESC, id`,
      [id],
    );
    return { roles: rows };
  });

  /** Gerente de cargos não-dono não mexe em admin nem dá bits que ele não tem. */
  function guardRole(m: Membership, permissions: number | undefined, current?: number) {
    if (m.isOwner) return;
    if ((current ?? 0) & PERM.ADMINISTRATOR) fail(403, "owner_only");
    if (permissions !== undefined && (permissions & PERM.ADMINISTRATOR || (permissions & ~m.perms) !== 0)) fail(403, "cannot_grant");
  }

  app.post("/servers/:id/roles", auth, async (req) => {
    const { id } = parse(params.id, req.params);
    const m = await requireMember(id, uid(req));
    requirePerm(m, PERM.MANAGE_ROLES);
    const body = parse(roleBody, req.body);
    guardRole(m, body.permissions);
    const { rows } = await pool.query(
      `INSERT INTO roles (server_id, name, permissions, color, position)
       VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(position),0)+1 FROM roles WHERE server_id=$1))
       RETURNING id, server_id AS "serverId", name, permissions, position, color`,
      [id, body.name ?? "novo cargo", body.permissions ?? 0, body.color ?? null],
    );
    await publish({ t: "ROLES_UPDATE", d: { serverId: id }, serverId: id });
    return { role: rows[0] };
  });

  app.patch("/servers/:id/roles/:roleId", auth, async (req) => {
    const { id, roleId } = parse(params.serverRole, req.params);
    const m = await requireMember(id, uid(req));
    requirePerm(m, PERM.MANAGE_ROLES);
    const body = parse(roleBody, req.body);
    const cur = await pool.query(`SELECT permissions, name FROM roles WHERE id=$1 AND server_id=$2`, [roleId, id]);
    if (!cur.rows[0]) fail(404, "role_not_found");
    guardRole(m, body.permissions, cur.rows[0].permissions);
    if (cur.rows[0].name === "@everyone" && body.name) fail(400, "cannot_rename_everyone");
    const { rows } = await pool.query(
      `UPDATE roles SET name=COALESCE($1,name), permissions=COALESCE($2,permissions), color=CASE WHEN $3::boolean THEN $4 ELSE color END
       WHERE id=$5 AND server_id=$6 RETURNING id, server_id AS "serverId", name, permissions, position, color`,
      [body.name ?? null, body.permissions ?? null, body.color !== undefined, body.color ?? null, roleId, id],
    );
    await publish({ t: "ROLES_UPDATE", d: { serverId: id }, serverId: id });
    return { role: rows[0] };
  });

  app.delete("/servers/:id/roles/:roleId", auth, async (req) => {
    const { id, roleId } = parse(params.serverRole, req.params);
    const m = await requireMember(id, uid(req));
    requirePerm(m, PERM.MANAGE_ROLES);
    const cur = await pool.query(`SELECT permissions, name FROM roles WHERE id=$1 AND server_id=$2`, [roleId, id]);
    if (!cur.rows[0]) fail(404, "role_not_found");
    if (cur.rows[0].name === "@everyone") fail(400, "cannot_delete_everyone");
    guardRole(m, undefined, cur.rows[0].permissions);
    await pool.query(`DELETE FROM roles WHERE id=$1 AND server_id=$2`, [roleId, id]);
    await publish({ t: "ROLES_UPDATE", d: { serverId: id }, serverId: id });
    return { ok: true };
  });

  for (const method of ["PUT", "DELETE"] as const) {
    app.route({
      method,
      url: "/servers/:id/roles/:roleId/members/:memberId",
      preHandler: [app.authenticate],
      handler: async (req) => {
        const { id, roleId, memberId } = parse(params.serverRoleMember, req.params);
        const m = await requireMember(id, uid(req));
        requirePerm(m, PERM.MANAGE_ROLES);
        const role = await pool.query(`SELECT permissions, name FROM roles WHERE id=$1 AND server_id=$2`, [roleId, id]);
        if (!role.rows[0] || role.rows[0].name === "@everyone") fail(404, "role_not_found");
        guardRole(m, undefined, role.rows[0].permissions);
        if (method === "PUT") {
          if (!(await membership(id, memberId))) fail(404, "member_not_found");
          await pool.query(`INSERT INTO member_roles (server_id,user_id,role_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [id, memberId, roleId]);
        } else {
          await pool.query(`DELETE FROM member_roles WHERE server_id=$1 AND role_id=$2 AND user_id=$3`, [id, roleId, memberId]);
        }
        await publish({ t: "ROLES_UPDATE", d: { serverId: id, userId: memberId }, serverId: id });
        return { ok: true };
      },
    });
  }

}
