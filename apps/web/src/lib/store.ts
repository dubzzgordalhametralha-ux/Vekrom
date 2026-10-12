import { create } from "zustand";
import type { Me, Presence } from "./api";
import { playDeafenSound, playJoinCallSound, playLeaveCallSound, playMuteSound, playUndeafenSound, playUnmuteSound } from "./sounds";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* modo privado: segue sem lembrar */
  }
}

// ---------------------------------------------------------------- sessão
interface SessionState {
  phase: "loading" | "authed" | "anon";
  user: Me | null;
  presence: Presence;
  setUser: (u: Me | null) => void;
  setPresence: (p: Presence) => void;
}
const storedPresence = read("vekrom:presence") as Presence | null;
export const useSession = create<SessionState>((set) => ({
  phase: "loading",
  user: null,
  presence: storedPresence && ["online", "idle", "dnd", "offline"].includes(storedPresence) ? storedPresence : "online",
  setUser: (user) => set({ user, phase: user ? "authed" : "anon" }),
  setPresence: (presence) => {
    write("vekrom:presence", presence);
    set({ presence });
  },
}));

// ---------------------------------------------------------------- tempo real
export interface VoiceParticipant {
  userId: string;
  channelId: string;
  mute: boolean;
  deaf: boolean;
  speaking: boolean;
  camera: boolean;
  sharing: boolean;
}
interface LiveState {
  presence: Record<string, Presence>;
  typing: Record<string, Record<string, { username: string; until: number }>>;
  unread: Record<string, string>; // channelId -> serverId
  voice: Record<string, VoiceParticipant>;
  gateway: "idle" | "connecting" | "ready" | "reconnecting";
}
export const useLive = create<LiveState>(() => ({ presence: {}, typing: {}, unread: {}, voice: {}, gateway: "idle" }));

export function presenceOf(userId: string, fallback?: Presence): Presence {
  return useLive.getState().presence[userId] ?? fallback ?? "offline";
}

// ---------------------------------------------------------------- voz (interface usada por voice-call.ts)
interface VoiceStore {
  channelId: string | null;
  label: string | null;
  muted: boolean;
  deafened: boolean;
  video: boolean;
  sharing: boolean;
  join: (id: string, label: string) => void;
  leave: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  setVideo: (v: boolean) => void;
  setSharing: (v: boolean) => void;
}
export const useVoice = create<VoiceStore>((set, get) => ({
  channelId: null,
  label: null,
  muted: false,
  deafened: false,
  video: false,
  sharing: false,
  join: (channelId, label) => {
    if (get().channelId === channelId) return;
    playJoinCallSound();
    set({ channelId, label });
  },
  leave: () => {
    if (!get().channelId) return;
    playLeaveCallSound();
    set({ channelId: null, label: null, video: false, sharing: false });
  },
  toggleMute: () =>
    set((s) => {
      (s.muted ? playUnmuteSound : playMuteSound)();
      return { muted: !s.muted, deafened: s.muted ? false : s.deafened };
    }),
  toggleDeafen: () =>
    set((s) => {
      (s.deafened ? playUndeafenSound : playDeafenSound)();
      return { deafened: !s.deafened, muted: !s.deafened ? true : s.muted };
    }),
  setVideo: (video) => set({ video }),
  setSharing: (sharing) => set({ sharing }),
}));

export function dmCallId(a: string, b: string): string {
  const [x, y] = [a, b].sort((p, q) => (BigInt(p) < BigInt(q) ? -1 : 1));
  return `dm-${x}-${y}`;
}

// ---------------------------------------------------------------- toasts
export interface Toast {
  id: number;
  text: string;
  tone: "info" | "error" | "success";
}
export const useToasts = create<{ items: Toast[] }>(() => ({ items: [] }));
let toastId = 0;
export function toast(text: string, tone: Toast["tone"] = "info") {
  const id = ++toastId;
  useToasts.setState((s) => ({ items: [...s.items.slice(-2), { id, text, tone }] }));
  window.setTimeout(() => useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) })), tone === "error" ? 5000 : 3200);
}
export function toastError(err: unknown) {
  toast(err instanceof Error ? err.message : "Não deu certo. Tente de novo.", "error");
}
