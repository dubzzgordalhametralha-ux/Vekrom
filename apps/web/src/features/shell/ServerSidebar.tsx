import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Hash, LogOut, Megaphone, MicOff, Plus, Settings, UserPlus, Volume2, HeadphoneOff } from "lucide-react";
import type { Channel, Server } from "../../lib/api";
import { can, PERM } from "../../lib/permissions";
import { memberMap, useChannels, useMembers } from "../../lib/queries";
import { useLive, useSession, useVoice } from "../../lib/store";
import { Avatar, Menu, MenuContent, MenuItem, MenuSep, MenuTrigger, Tip } from "../../components/ui";
import { useCall } from "../voice/VoiceProvider";

export type ServerAction = "invite" | "settings" | "create-channel" | "leave" | { edit: Channel };

function VoiceParticipants({ channelId, serverId }: { channelId: string; serverId: string }) {
  const voice = useLive((s) => s.voice);
  const members = memberMap(useMembers(serverId).data);
  const people = Object.values(voice).filter((v) => v.channelId === channelId);
  if (people.length === 0) return null;
  return (
    <ul className="mb-1 ml-7 space-y-0.5">
      {people.map((p) => {
        const m = members.get(p.userId);
        return (
          <li key={p.userId} className="flex h-8 items-center gap-2 rounded px-1.5 text-[13px] text-ink-2">
            <Avatar user={m ?? { id: p.userId, username: "?" }} size={22} speaking={p.speaking && !p.mute} />
            <span className="min-w-0 flex-1 truncate">{m?.username ?? "…"}</span>
            {p.sharing && <span className="rounded-sm bg-live px-1 text-[9px] font-bold text-white">AO VIVO</span>}
            {p.deaf ? <HeadphoneOff size={14} className="text-danger" /> : p.mute ? <MicOff size={14} className="text-danger" /> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function ServerSidebar({
  server,
  activeChannelId,
  onAction,
  onNavigate,
}: {
  server: Server;
  activeChannelId: string | null;
  onAction: (a: ServerAction) => void;
  onNavigate?: () => void;
}) {
  const { data: channels, isPending } = useChannels(server.id);
  const unread = useLive((s) => s.unread);
  const me = useSession((s) => s.user!.id);
  const voiceChannel = useVoice((s) => s.channelId);
  const join = useVoice((s) => s.join);
  const call = useCall();
  const isOwner = server.ownerId === me;
  const manageChannels = can(server.permissions, PERM.MANAGE_CHANNELS);
  const showSettings = isOwner || can(server.permissions, PERM.MANAGE_SERVER) || can(server.permissions, PERM.MANAGE_ROLES);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const text = (channels ?? []).filter((c) => c.type !== "voice");
  const voice = (channels ?? []).filter((c) => c.type === "voice");

  const section = (key: string, label: string, list: Channel[]) => (
    <div className="mt-4 first:mt-2">
      <div className="group/s flex items-center px-1">
        <button className="section-label flex flex-1 items-center gap-1 py-1 hover:text-ink-1" onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))} aria-expanded={!collapsed[key]}>
          <ChevronDown size={12} className={`transition-transform duration-150 ${collapsed[key] ? "-rotate-90" : ""}`} /> {label}
        </button>
        {manageChannels && (
          <Tip label="Criar canal">
            <button className="icon-btn h-6 w-6" onClick={() => onAction("create-channel")} aria-label={`Criar canal de ${label.toLowerCase()}`}>
              <Plus size={15} />
            </button>
          </Tip>
        )}
      </div>
      {!collapsed[key] &&
        list.map((c) => {
          const active = c.id === activeChannelId;
          const isUnread = Boolean(unread[c.id]) && !active;
          const isVoice = c.type === "voice";
          const Icon = isVoice ? Volume2 : c.type === "announcement" ? Megaphone : Hash;
          return (
            <div key={c.id}>
              <div className="group relative">
                {isUnread && <span className="absolute -left-2 top-1/2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-ink-1" aria-hidden />}
                <Link
                  to={`/channels/${server.id}/${c.id}`}
                  onClick={() => {
                    if (isVoice && voiceChannel !== c.id) {
                      void call.prepareSpeechContext(); // precisa do gesto do clique (autoplay)
                      join(c.id, `${c.name} / ${server.name}`);
                    }
                    onNavigate?.();
                  }}
                  data-active={active}
                  aria-current={active ? "page" : undefined}
                  className={`row h-9 pr-8 text-[14px] ${isUnread ? "font-semibold text-ink-1" : ""} ${isVoice && voiceChannel === c.id ? "text-online" : ""}`}
                >
                  <Icon size={17} className={active ? "text-ink-2" : "text-ink-4"} />
                  <span className="truncate">{c.name}</span>
                </Link>
                {manageChannels && (
                  <button
                    className="icon-btn absolute right-0.5 top-0.5 h-8 w-8 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:hidden"
                    onClick={() => onAction({ edit: c })}
                    aria-label={`Configurar ${c.name}`}
                  >
                    <Settings size={14} />
                  </button>
                )}
              </div>
              {isVoice && <VoiceParticipants channelId={c.id} serverId={server.id} />}
            </div>
          );
        })}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Menu>
        <MenuTrigger className="group flex h-14 shrink-0 items-center gap-2 border-b border-line px-4 text-left transition-colors hover:bg-white/[0.03] data-[state=open]:bg-white/[0.04]" aria-label="Menu do servidor">
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">{server.name}</span>
          <ChevronDown size={16} className="text-ink-3 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </MenuTrigger>
        <MenuContent align="start">
          <MenuItem onSelect={() => onAction("invite")} icon={<UserPlus size={16} className="text-volt" />}>Convidar pessoas</MenuItem>
          {showSettings && <MenuItem onSelect={() => onAction("settings")} icon={<Settings size={16} />}>Configurações do servidor</MenuItem>}
          {manageChannels && <MenuItem onSelect={() => onAction("create-channel")} icon={<Plus size={16} />}>Criar canal</MenuItem>}
          {!isOwner && (
            <>
              <MenuSep />
              <MenuItem danger onSelect={() => onAction("leave")} icon={<LogOut size={16} />}>Sair do servidor</MenuItem>
            </>
          )}
        </MenuContent>
      </Menu>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
        <button onClick={() => onAction("invite")} className="mx-1 mt-3 flex w-[calc(100%-8px)] items-center gap-2.5 rounded-lg bg-volt/[0.07] px-3 py-2.5 text-left ring-1 ring-inset ring-volt/20 transition-colors hover:bg-volt/[0.12]">
          <UserPlus size={16} className="text-volt" />
          <span className="text-[13px] font-medium text-ink-1">Chame seu squad</span>
        </button>
        {isPending ? (
          <div className="mt-5 space-y-2 px-2">
            {[70, 55, 80, 45].map((w) => <div key={w} className="skeleton h-5 rounded" style={{ width: `${w}%` }} />)}
          </div>
        ) : (
          <>
            {section("text", "Texto", text)}
            {voice.length > 0 && section("voice", "Voz", voice)}
          </>
        )}
      </div>
    </div>
  );
}
