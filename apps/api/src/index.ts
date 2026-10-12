import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { config, corsOrigins } from "./config.js";
import authPlugin from "./plugins/auth.js";
import { pool, dbHealth, initDb } from "./plugins/db.js";
import { redis, redisHealth } from "./plugins/redis.js";
import { authRoutes } from "./routes/auth.js";
import { serverRoutes } from "./routes/servers.js";
import { messageRoutes } from "./routes/messages.js";
import { socialRoutes } from "./routes/social.js";
import { userRoutes } from "./routes/users.js";
import { uploadRoutes } from "./routes/uploads.js";

await initDb();

const app = Fastify({
  // Caddy na frente: req.ip vem do X-Forwarded-For só se a conexão vier do proxy local.
  trustProxy: config.isProd ? "127.0.0.1,::1" : true,
  bodyLimit: 256 * 1024,
  logger: {
    level: config.LOG_LEVEL,
    redact: { paths: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'], remove: true },
  },
});

await app.register(cors, { origin: corsOrigins, credentials: true });
// Teto geral por IP; rotas sensíveis têm limites próprios (services/ratelimit.ts).
await app.register(rateLimit, { max: 600, timeWindow: "1 minute", allowList: ["127.0.0.1"] });
await app.register(multipart, { limits: { fileSize: config.UPLOAD_MAX_BYTES, files: 1, fields: 5 } });
await app.register(authPlugin);

app.setErrorHandler((err: Error & { statusCode?: number; details?: unknown; code?: string }, req, reply) => {
  const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  if (status >= 500) {
    req.log.error({ err }, "erro interno");
    return reply.code(500).send({ error: "internal_error" });
  }
  if (err.code === "FST_REQ_FILE_TOO_LARGE") return reply.code(413).send({ error: "file_too_large" });
  return reply.code(status).send({ error: err.message || "bad_request", ...(err.details ? { details: err.details } : {}) });
});

await app.register(authRoutes);
await app.register(serverRoutes);
await app.register(messageRoutes);
await app.register(socialRoutes);
await app.register(userRoutes);
await app.register(uploadRoutes);

app.get("/health", async (_req, reply) => {
  const [db, cache] = await Promise.all([dbHealth(), redisHealth()]);
  return reply.code(db && cache ? 200 : 503).send({ ok: db && cache, db, redis: cache });
});

// Graceful shutdown: para de aceitar, termina as requisições em curso, fecha pool e Redis.
let closing = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, async () => {
    if (closing) return;
    closing = true;
    app.log.info({ sig }, "encerrando");
    const force = setTimeout(() => process.exit(1), 10_000).unref();
    try {
      await app.close();
      await pool.end();
      await redis.quit();
    } finally {
      clearTimeout(force);
      process.exit(0);
    }
  });
}

await app.listen({ port: config.PORT, host: config.HOST });
