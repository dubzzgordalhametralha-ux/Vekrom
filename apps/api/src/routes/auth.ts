import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { pool } from "../plugins/db.js";
import { config } from "../config.js";
import { hashPassword, verifyPasswordOrDummy, generateRefreshToken, hashToken, refreshCookieOptions } from "../plugins/auth.js";
import { limit } from "../services/ratelimit.js";
import { fail, parse, uid } from "../lib/http.js";

export const USER_COLUMNS = `id, username, email, avatar_url AS "avatarUrl", bio, banner_color AS "bannerColor", created_at AS "createdAt"`;

export const username = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .regex(/^[a-zA-Z0-9_.]+$/, "use letras, números, _ ou .");

const registerSchema = z.object({ username, email: z.string().trim().email().max(255), password: z.string().min(8).max(128) });
const loginSchema = z.object({ email: z.string().trim().email().max(255), password: z.string().min(1).max(128) });

export async function authRoutes(app: FastifyInstance) {
  async function issue(reply: FastifyReply, user: { id: string; username: string }) {
    const token = app.jwt.sign({ sub: String(user.id), username: user.username });
    const { token: refresh, tokenHash } = generateRefreshToken();
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)`,
      [user.id, tokenHash, new Date(Date.now() + config.JWT_REFRESH_TTL_DAYS * 86_400_000)],
    );
    reply.setCookie("refreshToken", refresh, refreshCookieOptions());
    return token;
  }

  app.post("/auth/register", async (req, reply) => {
    await limit(`register:${req.ip}`, 20, 3600);
    const body = parse(registerSchema, req.body);
    const passwordHash = await hashPassword(body.password);
    try {
      const { rows } = await pool.query(
        `INSERT INTO users (username, discriminator, email, password_hash) VALUES ($1,$2,$3,$4) RETURNING ${USER_COLUMNS}`,
        [body.username, String(Math.floor(Math.random() * 9000) + 1000), body.email.toLowerCase(), passwordHash],
      );
      const user = rows[0];
      return { user, token: await issue(reply, user) };
    } catch (e: unknown) {
      const err = e as { code?: string; constraint?: string };
      if (err.code === "23505") fail(409, err.constraint?.includes("username") ? "username_in_use" : "email_in_use");
      throw e;
    }
  });

  app.post("/auth/login", async (req, reply) => {
    await limit(`login:${req.ip}`, 20, 600);
    const body = parse(loginSchema, req.body);
    const email = body.email.toLowerCase();
    await limit(`login:email:${email}`, 10, 900);
    const { rows } = await pool.query(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email=$1`, [email]);
    const row = rows[0];
    if (!(await verifyPasswordOrDummy(body.password, row?.password_hash))) fail(401, "invalid_credentials");
    const { password_hash: _ignored, ...user } = row;
    await pool.query(`DELETE FROM refresh_tokens WHERE user_id=$1 AND expires_at < NOW()`, [user.id]);
    return { user, token: await issue(reply, user) };
  });

  // Rotação: cada refresh invalida o anterior.
  app.post("/auth/refresh", async (req, reply) => {
    await limit(`refresh:${req.ip}`, 60, 600);
    const raw = req.cookies.refreshToken;
    if (!raw) fail(401, "no_refresh");
    const { rows } = await pool.query(
      `DELETE FROM refresh_tokens WHERE token_hash=$1 RETURNING user_id, expires_at`,
      [hashToken(raw)],
    );
    const row = rows[0];
    if (!row || new Date(row.expires_at) < new Date()) {
      reply.clearCookie("refreshToken", { path: config.COOKIE_PATH });
      fail(401, "expired");
    }
    const u = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id=$1`, [row.user_id]);
    if (!u.rows[0]) fail(401, "expired");
    return { user: u.rows[0], token: await issue(reply, u.rows[0]) };
  });

  app.post("/auth/logout", async (req, reply) => {
    const raw = req.cookies.refreshToken;
    if (raw) await pool.query(`DELETE FROM refresh_tokens WHERE token_hash=$1`, [hashToken(raw)]);
    reply.clearCookie("refreshToken", { path: config.COOKIE_PATH });
    return { ok: true };
  });

  app.get("/auth/me", { preHandler: [app.authenticate] }, async (req) => {
    const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id=$1`, [uid(req)]);
    if (!rows[0]) fail(401, "unauthorized");
    return { user: rows[0] };
  });
}
