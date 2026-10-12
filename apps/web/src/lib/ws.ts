/**
 * Cliente do gateway (WebSocket nativo).
 * - IDENTIFY logo após abrir (token nunca vai na URL).
 * - Heartbeat de aplicação a cada 25s; o servidor também pinga.
 * - Reconexão com backoff exponencial + jitter (1s → 30s).
 * - Token expirado (4004) ou recusado (4002): renova pelo refresh e reconecta.
 */
import { refresh } from "./api";

export interface GatewayEvent {
  t: string;
  d: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}
type Handler = (evt: GatewayEvent) => void;
export type GatewayStatus = "idle" | "connecting" | "ready" | "reconnecting";

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? "ws://localhost:3002";
const HEARTBEAT_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private status: () => string = () => "online";
  private handlers = new Set<Handler>();
  private statusHandlers = new Set<(s: GatewayStatus) => void>();
  private heartbeat: number | null = null;
  private attempts = 0;
  private reconnectTimer: number | null = null;
  private closedByUser = false;
  state: GatewayStatus = "idle";

  connect(token: string, presence: () => string): void {
    this.token = token;
    this.status = presence;
    this.closedByUser = false;
    if (!this.ws) this.open();
  }

  /** Token novo: reidentifica no mesmo socket (o servidor revalida e estende a sessão). */
  updateToken(token: string): void {
    this.token = token;
    if (this.state === "ready") this.send("IDENTIFY", { token });
  }

  disconnect(): void {
    this.closedByUser = true;
    this.clearTimers();
    this.ws?.close(1000, "logout");
    this.ws = null;
    this.setState("idle");
  }

  send(t: string, d: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t, d }));
  }

  subscribe(fn: Handler): () => void {
    this.handlers.add(fn);
    return () => void this.handlers.delete(fn);
  }

  onStatus(fn: (s: GatewayStatus) => void): () => void {
    this.statusHandlers.add(fn);
    return () => void this.statusHandlers.delete(fn);
  }

  private setState(s: GatewayStatus) {
    this.state = s;
    this.statusHandlers.forEach((h) => h(s));
  }

  private open(): void {
    if (!this.token) return;
    this.setState(this.attempts ? "reconnecting" : "connecting");
    const ws = new WebSocket(GATEWAY_URL);
    this.ws = ws;
    ws.onopen = () => {
      this.send("IDENTIFY", { token: this.token, status: this.status() });
      this.heartbeat = window.setInterval(() => this.send("HEARTBEAT", null), HEARTBEAT_MS);
    };
    ws.onmessage = (m: MessageEvent<string>) => {
      let evt: GatewayEvent;
      try {
        evt = JSON.parse(m.data);
      } catch {
        return;
      }
      if (!evt.t || evt.t === "HELLO" || evt.t === "HEARTBEAT_ACK") return;
      if (evt.t === "READY") {
        this.attempts = 0;
        this.setState("ready");
      }
      for (const h of this.handlers) {
        try {
          h(evt);
        } catch (err) {
          console.error("[gateway] handler", err);
        }
      }
    };
    ws.onclose = async (e) => {
      this.clearTimers();
      if (this.ws === ws) this.ws = null;
      if (this.closedByUser) return;
      if (e.code === 4002 || e.code === 4004) {
        const r = await refresh();
        if (!r) return this.setState("idle");
        this.token = r.token;
      }
      this.scheduleReconnect();
    };
  }

  /** Rede voltou: reconecta já, sem esperar o backoff. */
  retryNow(): void {
    if (this.closedByUser || this.ws || this.reconnectTimer === null) return;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.open();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.setState("reconnecting");
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempts) * (0.75 + Math.random() * 0.5);
    this.attempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.open();
    }, delay);
  }

  private clearTimers(): void {
    if (this.heartbeat !== null) window.clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}

export const gateway = new GatewayClient();

if (typeof window !== "undefined") window.addEventListener("online", () => gateway.retryNow());
