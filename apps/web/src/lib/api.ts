const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export type Presence = "online" | "idle" | "dnd" | "offline";

export interface Me {
  id: string;
  username: string;
  email: string;
  avatarUrl: string | null;
  bio: string | null;
  bannerColor: string | null;
  createdAt: string;
}
export interface UserLite {
  id: string;
  username: string;
  avatarUrl: string | null;
  bio?: string | null;
  bannerColor?: string | null;
  status?: Presence;
  createdAt?: string;
}
export interface Server {
  id: string;
  name: string;
  iconUrl: string | null;
  ownerId: string;
  createdAt: string;
  permissions: number;
}
export interface Channel {
  id: string;
  serverId: string;
  name: string;
  type: "text" | "voice" | "announcement";
  topic: string | null;
  position: number;
}
export interface Member extends UserLite {
  nickname: string | null;
  joinedAt: string;
  roleIds: string[];
  voiceMuted: boolean;
  soundMuted: boolean;
}
export interface Role {
  id: string;
  serverId: string;
  name: string;
  permissions: number;
  position: number;
  color: number | null;
}
export interface Attachment {
  url: string;
  name: string;
  contentType: string;
  sizeBytes: number;
}
export interface Reaction {
  emoji: string;
  count: number;
  me: boolean;
}
export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  attachments: Attachment[];
  createdAt: string;
  editedAt: string | null;
  author: UserLite;
  reactions: Reaction[];
  pending?: boolean;
}
export interface DirectMessage {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  attachments: Attachment[];
  createdAt: string;
  author: UserLite;
  pending?: boolean;
}
export interface Friend {
  id: string;
  status: "accepted" | "pending";
  direction: "incoming" | "outgoing";
  user: UserLite;
}
export interface Conversation {
  user: UserLite;
  lastMessage: string;
  lastAt: string;
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const MESSAGES: Record<string, string> = {
  invalid_credentials: "E-mail ou senha incorretos.",
  email_in_use: "Esse e-mail já tem conta.",
  username_in_use: "Esse nome de usuário já existe.",
  rate_limited: "Muitas tentativas. Espere um pouco e tente de novo.",
  invalid_request: "Confira os campos e tente de novo.",
  missing_permission: "Seu cargo não permite fazer isso.",
  owner_only: "Só o dono do servidor pode fazer isso.",
  owner_cannot_leave: "O dono não sai do servidor: transfira ou exclua.",
  invite_invalid: "Convite inválido ou expirado.",
  banned_from_server: "Você foi banido desse servidor.",
  user_not_found: "Não achamos ninguém com esse nome.",
  cannot_add_self: "Você não pode se adicionar.",
  already_friends: "Vocês já são amigos.",
  already_requested: "Pedido já enviado.",
  cannot_dm: "Vocês precisam ser amigos ou dividir um servidor.",
  invalid_type: "Tipo de arquivo não suportado. Use imagem, áudio ou vídeo MP4.",
  file_too_large: "Arquivo grande demais (máx. 8 MB).",
  invalid_password: "Senha incorreta.",
  internal_error: "Algo deu errado do nosso lado. Tente de novo.",
};

export class ApiError extends Error {
  constructor(public status: number, public code: string, public details?: Record<string, string[]>) {
    super(MESSAGES[code] ?? (status === 0 ? "Sem conexão com o servidor." : "Não deu certo. Tente de novo."));
  }
}

let accessToken: string | null = null;
let onAuthLost: () => void = () => undefined;
let onToken: (t: string) => void = () => undefined;
export function setAccessToken(t: string | null) {
  accessToken = t;
}
export function getAccessToken() {
  return accessToken;
}
export function onAuthEvents(h: { lost: () => void; token: (t: string) => void }) {
  onAuthLost = h.lost;
  onToken = h.token;
}

let refreshing: Promise<{ token: string; user: Me } | null> | null = null;
/** Renova o access token pelo cookie httpOnly. Uma chamada por vez. */
export function refresh(): Promise<{ token: string; user: Me } | null> {
  refreshing ??= fetch(`${API_BASE}/auth/refresh`, { method: "POST", credentials: "include" })
    .then(async (r) => {
      if (!r.ok) return null;
      const data = (await r.json()) as { token: string; user: Me };
      accessToken = data.token;
      onToken(data.token);
      return data;
    })
    .catch(() => null)
    .finally(() => (refreshing = null));
  return refreshing;
}

async function req<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const isForm = init.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(init.body && !isForm ? { "Content-Type": "application/json" } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, "network");
  }
  if (res.status === 401 && retry && !path.startsWith("/auth/")) {
    if (await refresh()) return req<T>(path, init, false);
    onAuthLost();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? "unknown", (data as { details?: Record<string, string[]> }).details);
  return data as T;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  login: (email: string, password: string) => req<{ token: string; user: Me }>("/auth/login", json("POST", { email, password })),
  register: (username: string, email: string, password: string) => req<{ token: string; user: Me }>("/auth/register", json("POST", { username, email, password })),
  logout: () => req<{ ok: true }>("/auth/logout", json("POST")),

  servers: () => req<{ servers: Server[] }>("/servers").then((r) => r.servers),
  createServer: (name: string, iconUrl?: string | null) => req<{ server: Server }>("/servers", json("POST", { name, iconUrl })).then((r) => r.server),
  updateServer: (id: string, data: { name?: string; iconUrl?: string | null }) => req<{ server: Server }>(`/servers/${id}`, json("PATCH", data)),
  deleteServer: (id: string) => req(`/servers/${id}`, json("DELETE")),
  leaveServer: (id: string) => req(`/servers/${id}/leave`, json("POST")),

  channels: (serverId: string) => req<{ channels: Channel[] }>(`/servers/${serverId}/channels`).then((r) => r.channels),
  createChannel: (serverId: string, name: string, type: Channel["type"], topic?: string) =>
    req<{ channel: Channel }>(`/servers/${serverId}/channels`, json("POST", { name, type, topic: topic || null })).then((r) => r.channel),
  updateChannel: (id: string, data: { name?: string; topic?: string | null }) => req<{ channel: Channel }>(`/channels/${id}`, json("PATCH", data)),
  deleteChannel: (id: string) => req(`/channels/${id}`, json("DELETE")),

  members: (serverId: string) => req<{ members: Member[] }>(`/servers/${serverId}/members`).then((r) => r.members),
  moderate: (serverId: string, memberId: string, action: "kick" | "ban" | "voice_mute" | "sound_mute", enabled = true) =>
    req(`/servers/${serverId}/members/${memberId}/moderation`, json("POST", { action, enabled })),

  roles: (serverId: string) => req<{ roles: Role[] }>(`/servers/${serverId}/roles`).then((r) => r.roles),
  createRole: (serverId: string, data: Partial<Pick<Role, "name" | "permissions" | "color">>) => req<{ role: Role }>(`/servers/${serverId}/roles`, json("POST", data)),
  updateRole: (serverId: string, roleId: string, data: Partial<Pick<Role, "name" | "permissions" | "color">>) =>
    req<{ role: Role }>(`/servers/${serverId}/roles/${roleId}`, json("PATCH", data)),
  deleteRole: (serverId: string, roleId: string) => req(`/servers/${serverId}/roles/${roleId}`, json("DELETE")),
  setMemberRole: (serverId: string, roleId: string, memberId: string, on: boolean) =>
    req(`/servers/${serverId}/roles/${roleId}/members/${memberId}`, json(on ? "PUT" : "DELETE")),

  createInvite: (serverId: string) => req<{ invite: { code: string; expiresAt: string | null } }>(`/servers/${serverId}/invites`, json("POST", {})).then((r) => r.invite),
  invite: (code: string) => req<{ invite: { code: string; server: { id: string; name: string; iconUrl: string | null; memberCount: number } } }>(`/invites/${code}`).then((r) => r.invite),
  joinInvite: (code: string) => req<{ server: Server }>(`/invites/${code}/join`, json("POST")).then((r) => r.server),

  messages: (channelId: string, before?: string) =>
    req<Page<Message>>(`/channels/${channelId}/messages?limit=50${before ? `&before=${encodeURIComponent(before)}` : ""}`),
  sendMessage: (channelId: string, content: string, attachments: Attachment[]) =>
    req<{ message: Message }>(`/channels/${channelId}/messages`, json("POST", { content, attachments })).then((r) => r.message),
  editMessage: (id: string, content: string) => req<{ message: Message }>(`/messages/${id}`, json("PATCH", { content })).then((r) => r.message),
  deleteMessage: (id: string) => req(`/messages/${id}`, json("DELETE")),
  react: (id: string, emoji: string, on: boolean) =>
    on ? req(`/messages/${id}/reactions`, json("PUT", { emoji })) : req(`/messages/${id}/reactions?emoji=${encodeURIComponent(emoji)}`, { method: "DELETE" }),

  friends: () => req<{ friends: Friend[] }>("/friends").then((r) => r.friends),
  addFriend: (username: string) => req<{ ok: true; accepted: boolean }>("/friends", json("POST", { username })),
  acceptFriend: (id: string) => req(`/friends/${id}/accept`, json("POST")),
  removeFriend: (id: string) => req(`/friends/${id}`, json("DELETE")),

  user: (id: string) => req<{ user: UserLite }>(`/users/${id}`).then((r) => r.user),
  conversations: () => req<{ conversations: Conversation[] }>("/dms").then((r) => r.conversations),
  dms: (userId: string, before?: string) => req<Page<DirectMessage>>(`/dms/${userId}/messages?limit=50${before ? `&before=${encodeURIComponent(before)}` : ""}`),
  sendDm: (userId: string, content: string, attachments: Attachment[]) =>
    req<{ message: DirectMessage }>(`/dms/${userId}/messages`, json("POST", { content, attachments })).then((r) => r.message),

  updateMe: (data: { username?: string; avatarUrl?: string | null; bio?: string | null; bannerColor?: string | null }) =>
    req<{ user: Me }>("/users/@me", json("PATCH", data)).then((r) => r.user),
  changePassword: (current: string, next: string) => req("/users/@me/password", json("POST", { current, next })),
  deleteAccount: (password: string) => req("/users/@me", json("DELETE", { password })),
  ice: () => req<{ iceServers: RTCIceServer[] }>("/voice/ice").then((r) => r.iceServers),

  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return req<{ url: string; contentType: string; sizeBytes: number; filename: string }>("/upload", { method: "POST", body: form });
  },
};
