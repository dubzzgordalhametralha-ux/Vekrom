import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { Redis } from "ioredis";
import jwt from "jsonwebtoken";
import pg from "pg";
import { CLOSE, Op, parseClient, SocketRateLimiter, type ClientMsg } from "./protocol.js";
import { SessionStore, type Session } from "./session.js";
import { PresenceStore, type PresenceStatus } from "./presence.js";
import { VoiceManager, type VoiceState } from "./voice.js";
import { MemRedis } from "./memredis.js";

const isProd = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT ?? process.env.GATEWAY_PORT ?? 3002);
const HOST = process.env.HOST ?? (isProd ? "127.0.0.1" : "0.0.0.0");
const JWT_SECRET = process.env.JWT_SECRET ?? (isProd ? "" : "dev-secret-troque-em-producao");
if (isProd && JWT_SECRET.length < 32) {
  console.error("[gateway] JWT_SECRET ausente ou curto em produção");
  process.exit(1);
}
const ORIGINS = new Set((process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",").map((s) => s.trim()));
const PING_MS = 30_000;
const IDENTIFY_TIMEOUT_MS = 10_000;

const log = (msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ level: "info", time: Date.now(), msg, ...extra }));
const logErr = (msg: string, err: unknown) =>
  console.error(JSON.stringify({ level: "error", time: Date.now(), msg, err: (err as Error)?.message ?? String(err) }));

// ---------------------------------------------------------------- Redis
async function connectRedis(): Promise<{ client: Redis; sub: Redis }> {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  const mk = () =>
    new Redis(url, { maxRetriesPerRequest: 2, retryStrategy: isProd ? (n) => Math.min(n * 200, 5000) : () => null });
  const client = mk();
  client.on("error", (e) => isProd && logErr("redis", e));
  const ok = await Promise.race([client.ping().then((p) => p === "PONG").catch(() => false), new Promise<boolean>((r) => setTimeout(() => r(false), 3000))]);
  if (ok) {
    const sub = mk();
    sub.on("error", (e) => isProd && logErr("redis sub", e));
    return { client, sub };
  }
  if (isProd) throw new Error("Redis indisponível em produção");
  client.disconnect();
  log("redis indisponível — MemRedis (só dev; eventos da API não chegam)");
  return { client: new MemRedis() as unknown as Redis, sub: new MemRedis() as unknown as Redis };
}
const { client: redis, sub: redisSub } = await connectRedis();

// ---------------------------------------------------------------- Postgres (só leitura de membership)
let db: pg.Pool | null = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://vekrom:vekrom@localhost:5432/vekrom",
  max: 2,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: "vekrom-gateway",
});
db.on("error", (e) => logErr("db idle", e));
try {
  await db.query("SELECT 1");
} catch (e) {
  if (isProd) throw e;
  log("postgres indisponível — gateway sem checagem de membership (só dev)");
  await db.end().catch(() => undefined);
  db = null;
}

async function serversOf(userId: string): Promise<Set<string>> {
  if (!db) return new Set();
  const { rows } = await db.query(`SELECT server_id FROM server_members WHERE user_id=$1 AND status='member'`, [userId]);
  return new Set(rows.map((r) => String(r.server_id)));
}
async function friendsOf(userId: string): Promise<Set<string>> {
  if (!db) return new Set();
  const { rows } = await db.query(
    `SELECT CASE WHEN requester_id=$1 THEN addressee_id ELSE requester_id END AS f FROM friendships
     WHERE status='accepted' AND (requester_id=$1 OR addressee_id=$1)`,
    [userId],
  );
  return new Set(rows.map((r) => String(r.f)));
}
const channelCache = new Map<string, { serverId: string; type: string } | null>();
async function channelInfo(channelId: string) {
  if (channelCache.has(channelId)) return channelCache.get(channelId)!;
  if (!db) return { serverId: "dev", type: "text" };
  const { rows } = await db.query(`SELECT server_id, type FROM channels WHERE id=$1`, [channelId]);
  const info = rows[0]?.server_id ? { serverId: String(rows[0].server_id), type: String(rows[0].type) } : null;
  if (channelCache.size > 5000) channelCache.clear();
  channelCache.set(channelId, info);
  return info;
}
async function canDm(a: string, b: string): Promise<boolean> {
  if (!db) return true;
  const { rows } = await db.query(
    `SELECT NOT EXISTS (SELECT 1 FROM friendships WHERE status='blocked' AND ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)))
       AND (EXISTS (SELECT 1 FROM friendships WHERE status='accepted' AND ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)))
         OR EXISTS (SELECT 1 FROM server_members x JOIN server_members y ON y.server_id=x.server_id
                    WHERE x.user_id=$1 AND y.user_id=$2 AND x.status='member' AND y.status='member')) AS ok`,
    [a, b],
  );
  return Boolean(rows[0]?.ok);
}
async function moderationFlags(serverId: string, userId: string) {
  if (!db) return { mute: false, deaf: false };
  const { rows } = await db.query(`SELECT voice_muted, sound_muted FROM server_members WHERE server_id=$1 AND user_id=$2`, [serverId, userId]);
  return { mute: Boolean(rows[0]?.voice_muted), deaf: Boolean(rows[0]?.sound_muted) };
}

// ---------------------------------------------------------------- estado
const sessions = new SessionStore();
const presence = new PresenceStore(redis);
const voice = new VoiceManager();
/** Para quem vai o estado de voz de cada canal: membros do servidor ou os 2 da DM. */
const voiceScope = new Map<string, { serverId?: string; userIds?: string[] }>();
/** Conexão que está na chamada (multi-aba: só uma fala). */
const voiceConn = new Map<string, string>();
const enforced = new Map<string, { mute: boolean; deaf: boolean }>();

let seq = 0;
function send(ws: WebSocket, op: Op, d: unknown, t: string | null = null): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op, d, s: ++seq, t }));
}
function dispatch(targets: Iterable<Session>, t: string, d: unknown): void {
  for (const s of targets) send(s.socket, Op.DISPATCH, d, t);
}
function voiceTargets(channelId: string): Session[] {
  const scope = voiceScope.get(channelId);
  if (!scope) return [];
  if (scope.serverId) return sessions.inServer(scope.serverId);
  return (scope.userIds ?? []).flatMap((u) => sessions.ofUser(u));
}

function leaveVoice(userId: string): void {
  const left = voice.leave(userId);
  voiceConn.delete(userId);
  enforced.delete(userId);
  if (!left) return;
  dispatch(voiceTargets(left.channelId), "voice:update", { voiceState: { userId, channelId: null, prevChannelId: left.channelId } });
  if (voice.participants(left.channelId).length === 0) voiceScope.delete(left.channelId);
}

function broadcastPresence(userId: string, status: PresenceStatus): void {
  const s = sessions.ofUser(userId)[0];
  const servers = s?.servers ?? new Set<string>();
  const friends = s?.friends ?? new Set<string>();
  dispatch(sessions.audienceOf(userId, servers, friends), "PRESENCE_UPDATE", { presence: { userId, status } });
}

// ---------------------------------------------------------------- eventos da API (Redis)
interface ApiEvent {
  t: string;
  d: Record<string, unknown>;
  serverId?: string;
  userIds?: string[];
  addMember?: string;
  removeMember?: string;
}

redisSub.on("pmessage", (_p: string, _ch: string, raw: string) => {
  let evt: ApiEvent;
  try {
    evt = JSON.parse(raw);
  } catch {
    return;
  }
  if (evt.addMember && evt.serverId) for (const s of sessions.ofUser(evt.addMember)) s.servers.add(evt.serverId);

  const targets = new Set<Session>();
  if (evt.serverId) sessions.inServer(evt.serverId).forEach((s) => targets.add(s));
  for (const u of evt.userIds ?? []) sessions.ofUser(u).forEach((s) => targets.add(s));
  if (evt.removeMember) sessions.ofUser(evt.removeMember).forEach((s) => targets.add(s));
  dispatch(targets, evt.t, evt.d);

  if (evt.removeMember && evt.serverId) {
    for (const s of sessions.ofUser(evt.removeMember)) s.servers.delete(evt.serverId);
    const ch = voice.currentChannelOf(evt.removeMember);
    if (ch && voiceScope.get(ch)?.serverId === evt.serverId) leaveVoice(evt.removeMember);
  }
  if (evt.t === "SERVER_DELETE" && evt.serverId) {
    for (const s of sessions.all()) s.servers.delete(evt.serverId);
    for (const [ch, scope] of voiceScope) if (scope.serverId === evt.serverId) voice.participants(ch).forEach((p) => leaveVoice(p.userId));
  }
  if (evt.t === "CHANNEL_DELETE") {
    const ch = String(evt.d.channelId);
    channelCache.delete(ch);
    voice.participants(ch).forEach((p) => leaveVoice(p.userId));
  }
  if (evt.t === "FRIEND_UPDATE") {
    for (const u of evt.userIds ?? []) {
      void friendsOf(u).then((f) => sessions.ofUser(u).forEach((s) => (s.friends = f))).catch((e) => logErr("friends", e));
    }
  }
  if (evt.t === "VOICE_MODERATION") {
    const d = evt.d as { userId: string; voiceMuted?: boolean; soundMuted?: boolean };
    const ch = voice.currentChannelOf(d.userId);
    if (ch && voiceScope.get(ch)?.serverId === evt.serverId) {
      const flags = enforced.get(d.userId) ?? { mute: false, deaf: false };
      if (d.voiceMuted !== undefined) flags.mute = d.voiceMuted;
      if (d.soundMuted !== undefined) flags.deaf = d.soundMuted;
      enforced.set(d.userId, flags);
      const state = voice.setFlags(d.userId, {
        ...(d.voiceMuted !== undefined ? { mute: d.voiceMuted } : {}),
        ...(d.soundMuted !== undefined ? { deaf: d.soundMuted } : {}),
      });
      if (state) dispatch(voiceTargets(ch), "voice:update", { voiceState: state });
    }
  }
});
await redisSub.psubscribe(process.env.EVENTS_CHANNEL ?? "vekrom:events");

// ---------------------------------------------------------------- WebSocket
const http = createServer((req, res) => {
  if (req.url === "/health") {
    void redis.ping().then(
      () => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, connections: sessions.size })),
      () => res.writeHead(503).end(JSON.stringify({ ok: false })),
    );
    return;
  }
  res.writeHead(426).end();
});

const wss = new WebSocketServer({
  server: http,
  maxPayload: 64 * 1024,
  perMessageDeflate: false, // poupa RAM (deflate custa ~300KB por conexão)
  // Browser sempre manda Origin: bloqueia uso do socket por outros sites (CSWSH).
  verifyClient: ({ origin }: { origin?: string }) => !isProd || !origin || ORIGINS.has(origin),
});

wss.on("connection", (ws: WebSocket) => {
  const connectionId = randomUUID();
  const limiter = new SocketRateLimiter(30, 15);
  let strikes = 0;
  let session: Session | null = null;
  let alive = true;
  let expiryTimer: NodeJS.Timeout | null = null;
  const typingAt = new Map<string, number>();

  send(ws, Op.HELLO, { heartbeat_interval: 25_000 }, "HELLO");
  const identifyTimer = setTimeout(() => !session && ws.close(CLOSE.NOT_IDENTIFIED, "identify timeout"), IDENTIFY_TIMEOUT_MS);
  ws.on("pong", () => (alive = true));

  async function identify(d: { token: string; status?: string }) {
    let payload: { sub: string; username: string; exp: number };
    try {
      payload = jwt.verify(d.token, JWT_SECRET) as typeof payload;
    } catch {
      send(ws, Op.DISPATCH, { code: CLOSE.AUTH_FAILED, message: "invalid token" }, "ERROR");
      ws.close(CLOSE.AUTH_FAILED, "auth failed");
      return;
    }
    const userId = String(payload.sub);
    if (session && session.userId !== userId) {
      ws.close(CLOSE.AUTH_FAILED, "user mismatch");
      return;
    }
    // Revalida a cada IDENTIFY (o cliente reidentifica ao renovar o token).
    const [servers, friends] = await Promise.all([serversOf(userId), friendsOf(userId)]);
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => {
      send(ws, Op.DISPATCH, { code: CLOSE.TOKEN_EXPIRED, message: "token expired" }, "ERROR");
      ws.close(CLOSE.TOKEN_EXPIRED, "token expired");
    }, Math.max(1000, payload.exp * 1000 - Date.now()));

    const first = !session;
    if (session) {
      session.servers = servers;
      session.friends = friends;
      session.expiresAt = payload.exp * 1000;
      return;
    }
    clearTimeout(identifyTimer);
    const status = (d.status ?? "online") as PresenceStatus;
    session = { connectionId, userId, username: String(payload.username), socket: ws, servers, friends, status, expiresAt: payload.exp * 1000 };
    sessions.add(session);
    await presence.set(userId, status).catch((e) => logErr("presence", e));
    if (first) broadcastPresence(userId, status);

    const voiceStates: VoiceState[] = [];
    for (const [ch, scope] of voiceScope) {
      if ((scope.serverId && servers.has(scope.serverId)) || scope.userIds?.includes(userId)) voiceStates.push(...voice.participants(ch));
    }
    send(ws, Op.DISPATCH, { user: { id: userId, username: session.username }, voiceStates }, "READY");
  }

  async function handle(msg: ClientMsg) {
    if (msg.t === "HEARTBEAT") {
      alive = true;
      if (session && session.status !== "offline") await presence.refresh(session.userId).catch(() => undefined);
      send(ws, Op.HEARTBEAT_ACK, { at: Date.now() }, "HEARTBEAT_ACK");
      return;
    }
    if (msg.t === "IDENTIFY") return identify(msg.d);
    if (!session) {
      ws.close(CLOSE.NOT_IDENTIFIED, "identify first");
      return;
    }
    const s = session;
    const uid = s.userId;

    if (msg.t === "TYPING_START") {
      const { channelId } = msg.d;
      if (Date.now() - (typingAt.get(channelId) ?? 0) < 2500) return;
      typingAt.set(channelId, Date.now());
      const info = await channelInfo(channelId);
      if (!info || info.type === "voice" || !s.servers.has(info.serverId)) return;
      dispatch(sessions.inServer(info.serverId), "TYPING_START", { channelId, userId: uid, username: s.username });
    } else if (msg.t === "PRESENCE_UPDATE") {
      for (const x of sessions.ofUser(uid)) x.status = msg.d.status;
      await presence.set(uid, msg.d.status).catch((e) => logErr("presence", e));
      broadcastPresence(uid, msg.d.status);
    } else if (msg.t === "VOICE_STATE_UPDATE") {
      const { channelId, ...flags } = msg.d;
      if (channelId === null) return leaveVoice(uid);
      const current = voice.currentChannelOf(uid);
      if (current === channelId) {
        // Só flags/speaking: mute/deaf impostos pela moderação não podem ser desligados pelo cliente.
        const enf = enforced.get(uid);
        const state =
          typeof flags.speaking === "boolean" && Object.keys(flags).length === 1
            ? voice.setSpeaking(uid, enf?.mute ? false : flags.speaking)
            : voice.setFlags(uid, { ...flags, mute: enf?.mute || flags.mute, deaf: enf?.deaf || flags.deaf });
        if (state) dispatch(voiceTargets(channelId), "voice:update", { voiceState: { ...state, speaking: enf?.mute ? false : state.speaking } });
        return;
      }
      // Entrar num canal: checa acesso.
      let scope: { serverId?: string; userIds?: string[] };
      let enf = { mute: false, deaf: false };
      const dm = /^dm-(\d+)-(\d+)$/.exec(channelId);
      if (dm) {
        const [a, b] = [dm[1], dm[2]];
        if ((uid !== a && uid !== b) || BigInt(a) >= BigInt(b)) return; // id canônico: dm-<menor>-<maior>
        if (!(await canDm(a, b))) return;
        scope = { userIds: [a, b] };
      } else {
        const info = await channelInfo(channelId);
        if (!info || info.type !== "voice" || !s.servers.has(info.serverId)) {
          send(ws, Op.DISPATCH, { code: 4030, message: "no access to voice channel" }, "ERROR");
          return;
        }
        scope = { serverId: info.serverId };
        enf = await moderationFlags(info.serverId, uid);
      }
      if (current) leaveVoice(uid);
      voiceScope.set(channelId, scope);
      voiceConn.set(uid, connectionId);
      if (enf.mute || enf.deaf) enforced.set(uid, enf);
      const state = voice.join(uid, channelId, { ...flags, mute: enf.mute || flags.mute, deaf: enf.deaf || flags.deaf });
      dispatch(voiceTargets(channelId), "voice:update", { voiceState: state });
      send(ws, Op.DISPATCH, { channelId, members: voice.participants(channelId) }, "voice:members");
      if (enf.mute || enf.deaf) send(ws, Op.DISPATCH, { userId: uid, voiceMuted: enf.mute, soundMuted: enf.deaf }, "VOICE_MODERATION");
    } else if (msg.t === "VOICE_SIGNAL") {
      const { to, scope, data } = msg.d;
      const ch = voice.currentChannelOf(uid);
      if (!ch || voice.currentChannelOf(to) !== ch) return; // só entre quem está na mesma chamada
      const target = sessions.get(voiceConn.get(to) ?? "");
      if (target) send(target.socket, Op.DISPATCH, { from: uid, data, scope }, "voice:signal");
    }
  }

  ws.on("message", (raw) => {
    if (!limiter.tryConsume()) {
      if (++strikes > 50) ws.close(CLOSE.RATE_LIMITED, "rate limited");
      return;
    }
    const msg = parseClient(raw.toString());
    if (!msg) return;
    handle(msg).catch((e) => logErr("handle", e));
  });

  ws.on("close", () => {
    clearTimeout(identifyTimer);
    if (expiryTimer) clearTimeout(expiryTimer);
    if (!session) return;
    sessions.remove(connectionId);
    const uid = session.userId;
    if (voiceConn.get(uid) === connectionId) leaveVoice(uid);
    if (sessions.ofUser(uid).length === 0) {
      void presence.set(uid, "offline").catch(() => undefined);
      dispatch(sessions.audienceOf(uid, session.servers, session.friends), "PRESENCE_UPDATE", { presence: { userId: uid, status: "offline" } });
    }
  });

  // Heartbeat de protocolo: derruba conexão morta (sem pong em 30s).
  const pinger = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, PING_MS);
  ws.on("close", () => clearInterval(pinger));
});

http.listen(PORT, HOST, () => log("gateway ouvindo", { port: PORT }));

// ---------------------------------------------------------------- shutdown
let closing = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, async () => {
    if (closing) return;
    closing = true;
    log("encerrando", { sig, connections: sessions.size });
    setTimeout(() => process.exit(1), 8000).unref();
    // 1012 = "service restart": o cliente reconecta com backoff.
    for (const c of wss.clients) c.close(1012, "restart");
    wss.close();
    http.close();
    await Promise.allSettled([redis.quit(), redisSub.quit(), db?.end()]);
    process.exit(0);
  });
}
