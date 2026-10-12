import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Hash, Volume2, WifiOff } from "lucide-react";
import { api, type Channel } from "../../lib/api";
import { useChannels, useMembers, useServers } from "../../lib/queries";
import { useRealtime } from "../../lib/realtime";
import { toastError, useLive, useSession, useVoice } from "../../lib/store";
import { Empty } from "../../components/ui";
import { VoiceProvider, useCall } from "../voice/VoiceProvider";
import { VoiceLobby, VoiceStage } from "../voice/VoiceView";
import { ChannelView, ChatHeader } from "../chat/ChannelView";
import { DmView } from "../chat/DmView";
import { FriendsView } from "../home/FriendsView";
import { MemberList } from "../members/MemberList";
import { ProfileModal } from "../members/ProfileModal";
import { ChannelSettingsModal, CreateChannelModal, CreateServerModal, InviteModal } from "../servers/ServerModals";
import { ServerRail } from "./ServerRail";
import { ServerSidebar, type ServerAction } from "./ServerSidebar";
import { DmSidebar } from "./DmSidebar";
import { UserBar } from "./UserBar";

const ServerSettingsModal = lazy(() => import("../servers/ServerSettingsModal"));
const UserSettingsModal = lazy(() => import("../settings/UserSettingsModal"));

function useDesktop() {
  const q = "(min-width: 768px)";
  const [v, setV] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setV(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return v;
}

/** Gaveta do celular: desliza da esquerda, fecha no toque fora ou arrastando. */
function Drawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; t: number } | null>(null);
  const [dx, setDx] = useState(0);
  useEffect(() => {
    if (!open) setDx(0);
  }, [open]);
  return (
    <div className={`fixed inset-0 z-40 md:hidden ${open ? "" : "pointer-events-none"}`} aria-hidden={!open} {...(!open ? { inert: "" } : {})}>
      <div className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`} onClick={onClose} />
      <div
        ref={panel}
        className="absolute inset-y-0 left-0 flex w-[min(88vw,360px)] overflow-hidden rounded-r-2xl bg-bg-1 shadow-pop [touch-action:pan-y]"
        style={{ transform: open ? `translateX(${Math.min(0, dx)}px)` : "translateX(-102%)", transition: start.current ? "none" : "transform 320ms var(--ease-drawer)" }}
        onPointerDown={(e) => e.pointerType === "touch" && (start.current = { x: e.clientX, t: Date.now() })}
        onPointerMove={(e) => start.current && setDx(e.clientX - start.current.x)}
        onPointerUp={(e) => {
          if (!start.current) return;
          const dist = e.clientX - start.current.x;
          const v = Math.abs(dist) / (Date.now() - start.current.t);
          start.current = null;
          if (dist < -80 || (dist < -20 && v > 0.11)) onClose();
          setDx(0);
        }}
        onPointerCancel={() => ((start.current = null), setDx(0))}
      >
        {children}
      </div>
    </div>
  );
}

function ShellInner() {
  useRealtime();
  const loc = useLocation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const desktop = useDesktop();
  const me = useSession((s) => s.user)!;
  const gatewayState = useLive((s) => s.gateway);
  const voiceChannel = useVoice((s) => s.channelId);
  const join = useVoice((s) => s.join);
  const call = useCall();

  const [, , a = "@me", b] = loc.pathname.split("/");
  const isHome = a === "@me";
  const servers = useServers();
  const server = isHome ? null : (servers.data?.find((s) => s.id === a) ?? null);
  const channels = useChannels(server?.id ?? null);
  const channel = channels.data?.find((c) => c.id === b) ?? null;
  const members = useMembers(server?.id ?? null);

  const [drawer, setDrawer] = useState(false);
  const [showMembers, setShowMembers] = useState(() => {
    try {
      return localStorage.getItem("vekrom:members") !== "0";
    } catch {
      return true;
    }
  });
  const [modal, setModal] = useState<null | "create-server" | "create-channel" | "invite" | "server-settings" | "user-settings">(null);
  const [editChannel, setEditChannel] = useState<Channel | null>(null);
  const [profile, setProfile] = useState<string | null>(null);

  useEffect(() => setDrawer(false), [loc.pathname]);

  // Servidor sumiu (excluído, expulso) ou canal apagado: volta para um lugar válido.
  useEffect(() => {
    if (!isHome && servers.data && !server) nav("/channels/@me", { replace: true });
  }, [isHome, servers.data, server, nav]);
  useEffect(() => {
    if (!server || !channels.data) return;
    if (b && !channel) nav(`/channels/${server.id}`, { replace: true });
    else if (!b && desktop) {
      const first = channels.data.find((c) => c.type !== "voice");
      if (first) nav(`/channels/${server.id}/${first.id}`, { replace: true });
    }
  }, [server, channels.data, channel, b, desktop, nav]);

  const onAction = async (act: ServerAction) => {
    if (typeof act === "object") return setEditChannel(act.edit);
    if (act === "leave") {
      if (!server || !confirm(`Sair de ${server.name}?`)) return;
      try {
        await api.leaveServer(server.id);
        await qc.invalidateQueries({ queryKey: ["servers"] });
        nav("/channels/@me");
      } catch (e) {
        toastError(e);
      }
      return;
    }
    setModal(act === "settings" ? "server-settings" : act);
  };
  const toggleMembers = () =>
    setShowMembers((v) => {
      try {
        localStorage.setItem("vekrom:members", v ? "0" : "1");
      } catch {
        /* ok */
      }
      return !v;
    });

  const people = new Map((members.data ?? []).map((m) => [m.id, m]));
  people.set(me.id, { ...me, nickname: null, joinedAt: "", roleIds: [], voiceMuted: false, soundMuted: false });

  // ---------------------------------------------------------------- painel (rail + lista)
  const rail = (onNavigate?: () => void) => (
    <ServerRail servers={servers.data ?? []} loading={servers.isPending} activeId={server?.id ?? null} onCreate={() => setModal("create-server")} onNavigate={onNavigate} />
  );
  const sidebar = (onNavigate?: () => void) => (
    <div className="flex min-w-0 flex-1 flex-col bg-bg-1 pt-[var(--safe-top)] md:w-[248px] md:flex-none md:pt-0">
      <div className="min-h-0 flex-1">
        {server ? <ServerSidebar server={server} activeChannelId={channel?.id ?? null} onAction={(x) => void onAction(x)} onNavigate={onNavigate} /> : <DmSidebar activeUserId={isHome ? (b ?? null) : null} onNavigate={onNavigate} />}
      </div>
      <UserBar onSettings={() => setModal("user-settings")} />
    </div>
  );
  const panel = (onNavigate?: () => void) => (
    <>
      {rail(onNavigate)}
      {sidebar(onNavigate)}
    </>
  );

  // ---------------------------------------------------------------- área principal
  const openDrawer = () => setDrawer(true);
  let main: ReactNode;
  if (isHome) {
    main = !b || b === "friends" ? <FriendsView onMenu={openDrawer} /> : <DmView key={b} userId={b} onMenu={openDrawer} onProfile={setProfile} />;
  } else if (server && channel?.type === "voice") {
    const label = `${channel.name} / ${server.name}`;
    main = (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ChatHeader onMenu={openDrawer}>
          <Volume2 size={19} className="text-ink-4" />
          <h1 className="truncate text-[15px] font-semibold">{channel.name}</h1>
        </ChatHeader>
        {voiceChannel === channel.id ? (
          <VoiceStage channelId={channel.id} people={people} />
        ) : (
          <VoiceLobby
            title={channel.name}
            channelId={channel.id}
            people={people}
            onJoin={() => {
              void call.prepareSpeechContext();
              join(channel.id, label);
            }}
          />
        )}
      </div>
    );
  } else if (server && channel) {
    main = <ChannelView key={channel.id} server={server} channel={channel} showMembers={showMembers} onToggleMembers={toggleMembers} onMenu={openDrawer} onInvite={() => setModal("invite")} onProfile={setProfile} />;
  } else {
    main = (
      <div className="flex flex-1 flex-col">
        <ChatHeader onMenu={openDrawer}>{server && <h1 className="truncate text-[15px] font-semibold">{server.name}</h1>}</ChatHeader>
        {channels.data && (
          <Empty icon={<Hash size={28} />} title="Nenhum canal de texto">
            Crie um canal pelo menu do servidor para começar a conversa.
          </Empty>
        )}
      </div>
    );
  }

  // No celular, sem canal/DM aberto, a tela é o próprio painel (como no app nativo).
  const mobilePanel = !desktop && !b && !(isHome && loc.pathname.endsWith("/friends"));

  return (
    <div className="flex h-dvh overflow-hidden bg-bg-0 pl-[var(--safe-left)] pr-[var(--safe-right)] text-ink-1">
      {gatewayState === "reconnecting" && (
        <div role="status" className="fixed inset-x-0 top-[var(--safe-top)] z-50 flex justify-center">
          <span className="anim-pop glass mt-2 flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-medium text-warn" data-state="open">
            <WifiOff size={14} /> Reconectando…
          </span>
        </div>
      )}

      {desktop ? (
        <>
          {rail()}
          {/* Moldura com canto arredondado: sidebar + conversa + membros como uma peça só. */}
          <div className="mt-2 flex min-w-0 flex-1 overflow-hidden rounded-tl-2xl border-l border-t border-line">
            {sidebar()}
            <main className="flex min-w-0 flex-1 flex-col border-l border-line bg-bg-2">{main}</main>
            {server && channel && channel.type !== "voice" && showMembers && <MemberList server={server} onProfile={setProfile} />}
          </div>
        </>
      ) : mobilePanel ? (
        <div className="flex min-w-0 flex-1">{panel()}</div>
      ) : (
        <>
          <main className="flex min-w-0 flex-1 flex-col bg-bg-2">{main}</main>
          <Drawer open={drawer} onClose={() => setDrawer(false)}>
            {panel(() => setDrawer(false))}
          </Drawer>
        </>
      )}

      <CreateServerModal open={modal === "create-server"} onClose={() => setModal(null)} />
      {server && <CreateChannelModal server={server} open={modal === "create-channel"} onClose={() => setModal(null)} />}
      {server && modal === "invite" && <InviteModal server={server} onClose={() => setModal(null)} />}
      {editChannel && <ChannelSettingsModal channel={editChannel} onClose={() => setEditChannel(null)} />}
      {profile && <ProfileModal userId={profile} server={server} onClose={() => setProfile(null)} />}
      <Suspense fallback={null}>
        {server && modal === "server-settings" && <ServerSettingsModal server={server} onClose={() => setModal(null)} />}
        {modal === "user-settings" && <UserSettingsModal onClose={() => setModal(null)} />}
      </Suspense>
    </div>
  );
}

export default function Shell() {
  return (
    <VoiceProvider>
      <ShellInner />
    </VoiceProvider>
  );
}
