import { pool } from "../plugins/db.js";

/**
 * Bits de permissão de cargo (roles.permissions, INTEGER). O dono do servidor tem tudo.
 * Qualquer membro pode ver canais, mandar mensagem e entrar em voz.
 * O web espelha esta tabela em apps/web/src/lib/permissions.ts.
 */
export const PERM = {
  ADMINISTRATOR: 1 << 0,
  MANAGE_SERVER: 1 << 1,
  MANAGE_CHANNELS: 1 << 2,
  MANAGE_ROLES: 1 << 3,
  MANAGE_MESSAGES: 1 << 4,
  KICK_MEMBERS: 1 << 5,
  BAN_MEMBERS: 1 << 6,
  MUTE_MEMBERS: 1 << 7,
  DEAFEN_MEMBERS: 1 << 8,
} as const;
export const ALL_PERMS = Object.values(PERM).reduce((a, b) => a | b, 0);

export interface Membership {
  serverId: string;
  ownerId: string;
  isOwner: boolean;
  perms: number;
}

/** Membership do usuário no servidor (null = não é membro ativo). */
export async function membership(serverId: string, userId: string): Promise<Membership | null> {
  const { rows } = await pool.query(
    `SELECT s.id, s.owner_id FROM servers s
     JOIN server_members m ON m.server_id = s.id AND m.user_id = $2 AND m.status = 'member'
     WHERE s.id = $1`,
    [serverId, userId],
  );
  const r = rows[0];
  if (!r) return null;
  const isOwner = String(r.owner_id) === String(userId);
  // Cargos do membro + @everyone (OR dos bits em JS; funciona igual no pg-mem).
  const roles = await pool.query(
    `SELECT r.permissions FROM roles r WHERE r.server_id = $1 AND (r.name = '@everyone'
       OR r.id IN (SELECT role_id FROM member_roles WHERE server_id = $1 AND user_id = $2))`,
    [serverId, userId],
  );
  let perms = roles.rows.reduce((acc: number, x: { permissions: number }) => acc | Number(x.permissions), 0);
  if (isOwner || perms & PERM.ADMINISTRATOR) perms = ALL_PERMS;
  return { serverId: String(r.id), ownerId: String(r.owner_id), isOwner, perms };
}

export function can(m: Membership | null, bit: number): boolean {
  return Boolean(m && (m.perms & bit) === bit);
}

/** Canal + membership de quem pede. null = canal não existe ou usuário não é membro. */
export async function channelAccess(channelId: string, userId: string) {
  const { rows } = await pool.query(`SELECT id, server_id, type, name FROM channels WHERE id = $1`, [channelId]);
  const ch = rows[0];
  if (!ch || ch.server_id === null) return null;
  const m = await membership(String(ch.server_id), userId);
  if (!m) return null;
  return { channel: { id: String(ch.id), serverId: String(ch.server_id), type: ch.type as string, name: ch.name as string }, m };
}

/** DM só entre amigos aceitos ou quem divide algum servidor; bloqueio impede. */
export async function canDirectMessage(a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const { rows } = await pool.query(
    `SELECT
       EXISTS (SELECT 1 FROM friendships WHERE status = 'blocked'
               AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))) AS blocked,
       EXISTS (SELECT 1 FROM friendships WHERE status = 'accepted'
               AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))) AS friends,
       EXISTS (SELECT 1 FROM server_members x JOIN server_members y ON y.server_id = x.server_id
               WHERE x.user_id = $1 AND y.user_id = $2 AND x.status = 'member' AND y.status = 'member') AS mutual`,
    [a, b],
  );
  const r = rows[0];
  return !r.blocked && (r.friends || r.mutual);
}
