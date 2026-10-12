import { z } from "zod";

/** Configuração única da API. Em produção, falha alto se faltar algo crítico. */
const isProd = process.env.NODE_ENV === "production";

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().default(3001),
  HOST: z.string().default(isProd ? "127.0.0.1" : "0.0.0.0"),
  DATABASE_URL: isProd ? z.string().min(1) : z.string().default("postgres://vekrom:vekrom@localhost:5432/vekrom"),
  PGPOOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  REDIS_URL: isProd ? z.string().min(1) : z.string().default("redis://localhost:6379"),
  JWT_SECRET: isProd
    ? z.string().min(32, "JWT_SECRET precisa ter 32+ caracteres em produção")
    : z.string().default("dev-secret-troque-em-producao"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  CORS_ORIGIN: isProd ? z.string().min(1) : z.string().default("http://localhost:5173"),
  COOKIE_PATH: z.string().default("/"),
  UPLOAD_DIR: z.string().default("./uploads"),
  UPLOAD_MAX_BYTES: z.coerce.number().int().default(8 * 1024 * 1024),
  PUBLIC_UPLOAD_URL: isProd ? z.string().url() : z.string().default("http://localhost:3001/files"),
  // TURN (voz). Vazio = só STUN. Ex.: TURN_URLS=turn:host:3478?transport=udp,turn:host:3478?transport=tcp
  TURN_URLS: z.string().default(""),
  TURN_SECRET: z.string().default(""),
  TURN_TTL_SEC: z.coerce.number().int().default(6 * 3600),
  LOG_LEVEL: z.string().default(isProd ? "info" : "debug"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("[config] variáveis de ambiente inválidas:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = { ...parsed.data, isProd };
export const corsOrigins = config.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);
