import type { Redis } from "ioredis";

export type PresenceStatus = "online" | "idle" | "dnd" | "offline";

const KEY = (userId: string) => `presence:${userId}`;
// Renovado a cada heartbeat (25s no cliente). Se o processo morrer, some sozinho.
const TTL_SEC = 70;

/** Presença em Redis com TTL; a API lê com MGET. "offline" (invisível) = sem chave. */
export class PresenceStore {
  constructor(private readonly redis: Redis) {}

  async set(userId: string, status: PresenceStatus): Promise<void> {
    if (status === "offline") await this.redis.del(KEY(userId));
    else await this.redis.set(KEY(userId), status, "EX", TTL_SEC);
  }

  async refresh(userId: string): Promise<void> {
    await this.redis.expire(KEY(userId), TTL_SEC);
  }
}
