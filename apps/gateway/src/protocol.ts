/**
 * Protocolo do gateway.
 * Servidor -> cliente: { op, d, s, t } (op 0 = DISPATCH com t = nome do evento).
 * Cliente -> servidor: { t, d } com t em IDENTIFY | HEARTBEAT | TYPING_START | PRESENCE_UPDATE | VOICE_STATE_UPDATE | VOICE_SIGNAL.
 */
export enum Op {
  DISPATCH = 0,
  HEARTBEAT_ACK = 11,
  HELLO = 10,
}

export const CLOSE = {
  AUTH_FAILED: 4002,
  NOT_IDENTIFIED: 4003,
  TOKEN_EXPIRED: 4004,
  RATE_LIMITED: 4008,
  BAD_ORIGIN: 4010,
} as const;

const ID = /^\d{1,18}$/;
const VOICE_ID = /^(\d{1,18}|dm-\d{1,18}-\d{1,18})$/;

export type ClientMsg =
  | { t: "IDENTIFY"; d: { token: string; status?: string } }
  | { t: "HEARTBEAT"; d?: unknown }
  | { t: "TYPING_START"; d: { channelId: string } }
  | { t: "PRESENCE_UPDATE"; d: { status: "online" | "idle" | "dnd" | "offline" } }
  | { t: "VOICE_STATE_UPDATE"; d: { channelId: string | null; mute?: boolean; deaf?: boolean; speaking?: boolean; camera?: boolean; sharing?: boolean } }
  | { t: "VOICE_SIGNAL"; d: { to: string; scope: "cam" | "screen"; data: Record<string, unknown> } };

const STATUSES = new Set(["online", "idle", "dnd", "offline"]);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const optBool = (v: unknown) => v === undefined || typeof v === "boolean";

/** Valida a mensagem do cliente. null = descartar. */
export function parseClient(raw: string): ClientMsg | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(m) || typeof m.t !== "string") return null;
  const d = m.d;
  switch (m.t) {
    case "HEARTBEAT":
      return { t: "HEARTBEAT" };
    case "IDENTIFY":
      return isObj(d) && typeof d.token === "string" && d.token.length < 4096 && (d.status === undefined || STATUSES.has(String(d.status)))
        ? (m as ClientMsg)
        : null;
    case "TYPING_START":
      return isObj(d) && typeof d.channelId === "string" && ID.test(d.channelId) ? (m as ClientMsg) : null;
    case "PRESENCE_UPDATE":
      return isObj(d) && STATUSES.has(String(d.status)) ? (m as ClientMsg) : null;
    case "VOICE_STATE_UPDATE":
      return isObj(d) && (d.channelId === null || (typeof d.channelId === "string" && VOICE_ID.test(d.channelId))) &&
        optBool(d.mute) && optBool(d.deaf) && optBool(d.speaking) && optBool(d.camera) && optBool(d.sharing)
        ? (m as ClientMsg)
        : null;
    case "VOICE_SIGNAL":
      return isObj(d) && typeof d.to === "string" && ID.test(d.to) && (d.scope === "cam" || d.scope === "screen") && isObj(d.data)
        ? (m as ClientMsg)
        : null;
    default:
      return null;
  }
}

/** Token bucket por socket. */
export class SocketRateLimiter {
  private tokens: number;
  private last = Date.now();
  constructor(private readonly max = 30, private readonly perSec = 15) {
    this.tokens = max;
  }
  tryConsume(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.max, this.tokens + ((now - this.last) / 1000) * this.perSec);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
