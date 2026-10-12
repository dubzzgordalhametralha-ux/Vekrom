import { redis } from "../plugins/redis.js";
import { HttpError } from "../lib/http.js";

/** Janela deslizante por chave (sorted set no Redis). */
export async function takeToken(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; remaining: number }> {
  const now = Date.now();
  const k = `rl:${key}`;
  const res = await redis
    .pipeline()
    .zremrangebyscore(k, 0, now - windowSec * 1000)
    .zadd(k, now, `${now}:${Math.random().toString(36).slice(2)}`)
    .zcard(k)
    .expire(k, windowSec + 1)
    .exec();
  const count = Number(res?.[2]?.[1] ?? 0);
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}

/** Lança 429 se estourar. */
export async function limit(key: string, max: number, windowSec: number): Promise<void> {
  const { allowed } = await takeToken(key, max, windowSec);
  if (!allowed) throw new HttpError(429, "rate_limited");
}
