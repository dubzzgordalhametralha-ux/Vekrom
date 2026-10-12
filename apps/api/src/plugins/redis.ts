import { Redis } from "ioredis";
import { config } from "../config.js";
import { MemRedis } from "./memredis.js";

async function ping(client: Redis, ms: number): Promise<boolean> {
  try {
    const pong = await Promise.race([client.ping(), new Promise<string>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
    return pong === "PONG";
  } catch {
    return false;
  }
}

/** Redis real. Em produção falha alto; fora dela cai para MemRedis (modo sem Docker). */
async function boot(): Promise<Redis> {
  const client = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 2,
    // Produção: reconecta com backoff; dev: desiste rápido e usa memória.
    retryStrategy: config.isProd ? (n) => Math.min(n * 200, 5000) : () => null,
    enableReadyCheck: true,
  });
  client.on("error", (e) => {
    if (config.isProd) console.error("[redis]", e.message);
  });
  if (await ping(client, 3000)) {
    console.log("[redis] conectado");
    return client;
  }
  if (config.isProd) throw new Error("Redis indisponível em produção");
  client.disconnect();
  console.warn("[redis] indisponível — usando MemRedis (só dev)");
  return new MemRedis() as unknown as Redis;
}

export const redis: Redis = await boot();
export const EVENTS_CHANNEL = process.env.EVENTS_CHANNEL ?? "vekrom:events";

export async function redisHealth(): Promise<boolean> {
  return ping(redis, 1000);
}

/**
 * Evento para o gateway. Um canal só: o gateway roteia por serverId ou userIds.
 * `addMember`/`removeMember` atualizam a lista de servidores das sessões abertas.
 */
export interface GatewayEvent {
  t: string;
  d: unknown;
  serverId?: string;
  userIds?: string[];
  addMember?: string;
  removeMember?: string;
}

export async function publish(evt: GatewayEvent): Promise<void> {
  try {
    await redis.publish(EVENTS_CHANNEL, JSON.stringify(evt));
  } catch (err) {
    console.error("[redis] publish falhou", evt.t, (err as Error).message);
  }
}

/** Presença atual (gravada pelo gateway com TTL). */
export async function presenceOf(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const vals = await redis.mget(...ids.map((id) => `presence:${id}`)).catch(() => [] as (string | null)[]);
  const out: Record<string, string> = {};
  ids.forEach((id, i) => (out[id] = vals[i] ?? "offline"));
  return out;
}
