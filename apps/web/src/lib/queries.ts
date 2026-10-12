import { useQuery } from "@tanstack/react-query";
import { api, type Member, type Presence } from "./api";
import { useLive } from "./store";

export const useServers = () => useQuery({ queryKey: ["servers"], queryFn: api.servers });
export const useChannels = (serverId: string | null) =>
  useQuery({ queryKey: ["channels", serverId], queryFn: () => api.channels(serverId!), enabled: Boolean(serverId) });
export const useMembers = (serverId: string | null) =>
  useQuery({ queryKey: ["members", serverId], queryFn: () => api.members(serverId!), enabled: Boolean(serverId) });
export const useRoles = (serverId: string | null) =>
  useQuery({ queryKey: ["roles", serverId], queryFn: () => api.roles(serverId!), enabled: Boolean(serverId) });
export const useFriends = () => useQuery({ queryKey: ["friends"], queryFn: api.friends });
export const useConversations = () => useQuery({ queryKey: ["conversations"], queryFn: api.conversations });

/** Presença ao vivo (gateway) com fallback no que a API trouxe. */
export function usePresence(userId: string | undefined, fallback?: Presence): Presence {
  return useLive((s) => (userId ? s.presence[userId] : undefined)) ?? fallback ?? "offline";
}

export function memberMap(members: Member[] | undefined) {
  return new Map((members ?? []).map((m) => [m.id, m]));
}
