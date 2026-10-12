import { EventEmitter } from "node:events";

/**
 * MemRedis — fallback em memória quando não há Redis (modo sem Docker).
 * Implementa o subconjunto usado pelo projeto: kv com EX/NX, expire, del,
 * sorted-set mínimo p/ rate-limit, publish + psubscribe (glob *) p/ fanout local.
 */

interface ZEntry {
  score: number;
  member: string;
}

function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${glob.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
}

class MemPipeline {
  private ops: Array<() => unknown> = [];
  constructor(private readonly r: MemRedis) {}
  set(k: string, v: string, ...a: unknown[]): this {
    this.ops.push(() => this.r.set(k, v, ...a));
    return this;
  }
  del(...ks: string[]): this {
    this.ops.push(() => this.r.del(...ks));
    return this;
  }
  publish(ch: string, msg: string): this {
    this.ops.push(() => this.r.publish(ch, msg));
    return this;
  }
  zadd(k: string, score: number, member: string): this {
    this.ops.push(() => this.r.zadd(k, score, member));
    return this;
  }
  zremrangebyscore(k: string, min: number, max: number): this {
    this.ops.push(() => this.r.zremrangebyscore(k, min, max));
    return this;
  }
  zcard(k: string): this {
    this.ops.push(() => this.r.zcard(k));
    return this;
  }
  expire(k: string, s: number): this {
    this.ops.push(() => this.r.expire(k, s));
    return this;
  }
  async exec(): Promise<Array<[null, unknown]>> {
    const out: Array<[null, unknown]> = [];
    for (const op of this.ops) out.push([null, await op()]);
    return out;
  }
}

export class MemRedis extends EventEmitter {
  private kv = new Map<string, { v: string; exp?: number }>();
  private zsets = new Map<string, ZEntry[]>();
  private patterns: RegExp[] = [];
  private static bus = new EventEmitter();

  constructor() {
    super();
    MemRedis.bus.setMaxListeners(50);
    MemRedis.bus.on("message", (channel: string, msg: string) => {
      for (const re of this.patterns) {
        if (re.test(channel)) this.emit("pmessage", "*", channel, msg);
      }
    });
  }

  private alive(k: string): boolean {
    const e = this.kv.get(k);
    if (!e) return false;
    if (e.exp !== undefined && e.exp < Date.now()) {
      this.kv.delete(k);
      return false;
    }
    return true;
  }

  async ping(): Promise<string> {
    return "PONG";
  }
  async get(k: string): Promise<string | null> {
    return this.alive(k) ? (this.kv.get(k)?.v ?? null) : null;
  }
  async mget(...ks: string[]): Promise<Array<string | null>> {
    return Promise.all(ks.map((k) => this.get(k)));
  }
  async quit(): Promise<string> {
    return "OK";
  }
  async set(k: string, v: string, ...args: unknown[]): Promise<string | null> {
    let exMs: number | undefined;
    let nx = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "EX") exMs = Number(args[++i]) * 1000;
      else if (args[i] === "NX") nx = true;
    }
    if (nx && this.alive(k)) return null;
    this.kv.set(k, { v, exp: exMs === undefined ? undefined : Date.now() + exMs });
    return "OK";
  }
  async expire(k: string, s: number): Promise<number> {
    const e = this.kv.get(k);
    if (!e) return 0;
    e.exp = Date.now() + s * 1000;
    return 1;
  }
  async del(...ks: string[]): Promise<number> {
    let n = 0;
    for (const k of ks) {
      if (this.kv.delete(k)) n++;
      if (this.zsets.delete(k)) n++;
    }
    return n;
  }
  async publish(channel: string, message: string): Promise<number> {
    MemRedis.bus.emit("message", channel, message);
    return 1;
  }
  async psubscribe(...patterns: string[]): Promise<void> {
    this.patterns.push(...patterns.map(globToRegExp));
  }
  async punsubscribe(): Promise<void> {
    this.patterns = [];
  }
  pipeline(): MemPipeline {
    return new MemPipeline(this);
  }

  // sorted set mínimo (rate limit)
  async zadd(k: string, score: number, member: string): Promise<number> {
    const arr = this.zsets.get(k) ?? [];
    arr.push({ score, member });
    this.zsets.set(k, arr);
    return 1;
  }
  async zremrangebyscore(k: string, min: number, max: number): Promise<number> {
    const arr = this.zsets.get(k) ?? [];
    const kept = arr.filter((e) => e.score < min || e.score > max);
    this.zsets.set(k, kept);
    return arr.length - kept.length;
  }
  async zcard(k: string): Promise<number> {
    return (this.zsets.get(k) ?? []).length;
  }
}
