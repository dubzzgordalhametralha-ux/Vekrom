import { useEffect } from "react";
import { useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { getAccessToken, refresh, type DirectMessage, type Message, type Page } from "./api";
import { gateway, type GatewayEvent } from "./ws";
import { toast, useLive, useSession, type VoiceParticipant } from "./store";

/** Canal/DM que está na tela agora (não marca como não lido). */
export const viewing = { channelId: null as string | null, dmUserId: null as string | null };

type Pages<T> = InfiniteData<Page<T>, string | undefined>;

/** Acrescenta (ou troca) item na página mais nova do histórico. */
export function upsertNewest<T extends { id: string }>(qc: QueryClient, key: unknown[], item: T, replaceId?: string) {
  qc.setQueryData<Pages<T>>(key, (data) => {
    if (!data) return data;
    const pages = data.pages.map((p) => ({ ...p, items: p.items.filter((m) => m.id !== replaceId) }));
    if (pages.some((p) => p.items.some((m) => m.id === item.id))) {
      return { ...data, pages: pages.map((p) => ({ ...p, items: p.items.map((m) => (m.id === item.id ? item : m)) })) };
    }
    pages[0] = { ...pages[0], items: [...pages[0].items, item] };
    return { ...data, pages };
  });
}

export function mapMessages<T extends { id: string }>(qc: QueryClient, key: unknown[], fn: (m: T) => T | null) {
  qc.setQueryData<Pages<T>>(key, (data) =>
    data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map(fn).filter((m): m is T => m !== null) })) } : data,
  );
}

function handle(qc: QueryClient, evt: GatewayEvent) {
  const me = useSession.getState().user?.id;
  const d = evt.d ?? {};
  switch (evt.t) {
    case "READY": {
      const voice: Record<string, VoiceParticipant> = {};
      for (const v of d.voiceStates ?? []) voice[v.userId] = v;
      useLive.setState({ voice });
      // Reconectou: busca o que passou enquanto estava fora.
      void qc.invalidateQueries();
      break;
    }
    case "MESSAGE_CREATE": {
      const m = d.message as Message;
      upsertNewest(qc, ["messages", m.channelId], m);
      if (viewing.channelId !== m.channelId && m.authorId !== me) {
        useLive.setState((s) => ({ unread: { ...s.unread, [m.channelId]: String(d.serverId) } }));
      }
      useLive.setState((s) => {
        const t = { ...(s.typing[m.channelId] ?? {}) };
        delete t[m.authorId];
        return { typing: { ...s.typing, [m.channelId]: t } };
      });
      break;
    }
    case "MESSAGE_UPDATE": {
      const m = d.message as Message;
      mapMessages<Message>(qc, ["messages", m.channelId], (x) => (x.id === m.id ? { ...m, reactions: x.reactions } : x));
      break;
    }
    case "MESSAGE_DELETE":
      mapMessages<Message>(qc, ["messages", String(d.channelId)], (x) => (x.id === d.id ? null : x));
      break;
    case "REACTION_UPDATE":
      mapMessages<Message>(qc, ["messages", String(d.channelId)], (x) => {
        if (x.id !== d.messageId) return x;
        const mine = new Set(x.reactions.filter((r) => r.me).map((r) => r.emoji));
        if (d.userId === me) (d.added ? mine.add(d.emoji) : mine.delete(d.emoji));
        return { ...x, reactions: (d.reactions as Array<{ emoji: string; count: number }>).map((r) => ({ ...r, me: mine.has(r.emoji) })) };
      });
      break;
    case "CHANNEL_CREATE":
    case "CHANNEL_UPDATE":
    case "CHANNEL_DELETE":
      void qc.invalidateQueries({ queryKey: ["channels", String(d.channel?.serverId ?? d.serverId)] });
      break;
    case "SERVER_CREATE":
    case "SERVER_UPDATE":
    case "SERVER_DELETE":
    case "ROLES_UPDATE":
      void qc.invalidateQueries({ queryKey: ["servers"] });
      if (evt.t === "ROLES_UPDATE") {
        void qc.invalidateQueries({ queryKey: ["roles", String(d.serverId)] });
        void qc.invalidateQueries({ queryKey: ["members", String(d.serverId)] });
      }
      break;
    case "MEMBER_JOIN":
    case "MEMBER_LEAVE":
    case "USER_UPDATE":
    case "VOICE_MODERATION":
      if (d.serverId) void qc.invalidateQueries({ queryKey: ["members", String(d.serverId)] });
      else void qc.invalidateQueries({ queryKey: ["members"] });
      if (evt.t === "MEMBER_LEAVE" && d.userId === me) {
        void qc.invalidateQueries({ queryKey: ["servers"] });
        if (d.reason) toast(d.reason === "ban" ? "Você foi banido de um servidor." : "Você foi removido de um servidor.", "error");
      }
      break;
    case "DM_CREATE": {
      const m = d.message as DirectMessage;
      const other = m.senderId === me ? m.recipientId : m.senderId;
      upsertNewest(qc, ["dms", other], m);
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      if (m.senderId !== me && viewing.dmUserId !== other) useLive.setState((s) => ({ unread: { ...s.unread, [`dm:${other}`]: "@me" } }));
      break;
    }
    case "FRIEND_UPDATE":
      void qc.invalidateQueries({ queryKey: ["friends"] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      break;
    case "PRESENCE_UPDATE":
      useLive.setState((s) => ({ presence: { ...s.presence, [d.presence.userId]: d.presence.status } }));
      break;
    case "TYPING_START":
      if (d.userId === me) break;
      useLive.setState((s) => ({
        typing: { ...s.typing, [d.channelId]: { ...(s.typing[d.channelId] ?? {}), [d.userId]: { username: d.username, until: Date.now() + 6500 } } },
      }));
      break;
    case "voice:update": {
      const v = d.voiceState as VoiceParticipant & { channelId: string | null };
      useLive.setState((s) => {
        const voice = { ...s.voice };
        if (v.channelId) voice[v.userId] = { ...voice[v.userId], ...v } as VoiceParticipant;
        else delete voice[v.userId];
        return { voice };
      });
      break;
    }
    case "ERROR":
      if (d.code === 4030) toast("Você não tem acesso a esse canal de voz.", "error");
      break;
  }
}

/** Liga o gateway enquanto houver sessão e mantém o token vivo. */
export function useRealtime() {
  const qc = useQueryClient();
  const authed = useSession((s) => s.phase === "authed");

  useEffect(() => {
    if (!authed) return;
    const token = getAccessToken();
    if (!token) return;
    gateway.connect(token, () => useSession.getState().presence);
    const offEvt = gateway.subscribe((e) => handle(qc, e));
    const offStatus = gateway.onStatus((s) => useLive.setState({ gateway: s }));
    // Access token dura 15 min: renova aos 12 e reidentifica no mesmo socket.
    const renew = window.setInterval(async () => {
      const r = await refresh();
      if (r) gateway.updateToken(r.token);
    }, 12 * 60_000);
    const prune = window.setInterval(() => {
      const now = Date.now();
      const typing = useLive.getState().typing;
      let changed = false;
      const next: typeof typing = {};
      for (const [ch, users] of Object.entries(typing)) {
        next[ch] = Object.fromEntries(Object.entries(users).filter(([, u]) => u.until > now));
        if (Object.keys(next[ch]).length !== Object.keys(users).length) changed = true;
      }
      if (changed) useLive.setState({ typing: next });
    }, 1500);
    return () => {
      offEvt();
      offStatus();
      clearInterval(renew);
      clearInterval(prune);
      gateway.disconnect();
    };
  }, [authed, qc]);
}
