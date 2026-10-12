import bcrypt from "bcryptjs";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import fp from "fastify-plugin";
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";

export interface AccessPayload {
  sub: string;
  username: string;
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AccessPayload;
    user: AccessPayload;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Hash fixo para gastar o mesmo tempo quando o e-mail não existe (não revela quem tem conta).
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString("hex"), 12);
export async function verifyPasswordOrDummy(password: string, hash: string | undefined): Promise<boolean> {
  const ok = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return Boolean(hash) && ok;
}

/** Refresh token opaco; no banco fica só o SHA-256. */
export function generateRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(48).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function refreshCookieOptions() {
  return {
    path: config.COOKIE_PATH,
    httpOnly: true,
    secure: config.isProd,
    // Web e API no mesmo domínio: strict não quebra nada e bloqueia CSRF no refresh.
    sameSite: "strict" as const,
    maxAge: config.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60,
  };
}

const authPlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  await app.register(cookie);
  await app.register(jwt, { secret: config.JWT_SECRET, sign: { expiresIn: config.JWT_ACCESS_TTL } });

  app.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      await reply.code(401).send({ error: "unauthorized" });
    }
  });
};

export default fp(authPlugin);
