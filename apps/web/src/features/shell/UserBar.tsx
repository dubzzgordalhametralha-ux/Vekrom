import { Headphones, HeadphoneOff, Mic, MicOff, MonitorUp, PhoneOff, Settings, Video, VideoOff, Signal } from "lucide-react";
import type { Presence } from "../../lib/api";
import { useSession, useVoice } from "../../lib/store";
import { gateway } from "../../lib/ws";
import { Avatar, Menu, MenuContent, MenuItem, MenuTrigger, PresenceDot, Tip, presenceLabel } from "../../components/ui";
import { useCall } from "../voice/VoiceProvider";

const STATUSES: Presence[] = ["online", "idle", "dnd", "offline"];

function VoicePanel() {
  const { label, video, sharing, leave } = useVoice();
  const call = useCall();
  return (
    <div className="border-t border-line px-3 pb-2 pt-2.5">
      <div className="flex items-center gap-2">
        <Signal size={16} className="text-online" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-online">Voz conectada</p>
          <p className="truncate text-[12px] text-ink-3">{label}</p>
        </div>
        <Tip label="Sair da chamada">
          <button className="icon-btn hover:!bg-danger/15 hover:!text-danger" onClick={leave} aria-label="Sair da chamada">
            <PhoneOff size={18} />
          </button>
        </Tip>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <button className="btn btn-ghost h-8 px-2 text-[12px]" data-active={video} onClick={() => void call.toggleCamera()} aria-pressed={video}>
          {video ? <VideoOff size={15} /> : <Video size={15} />} {video ? "Câmera off" : "Câmera"}
        </button>
        <button className={`btn h-8 px-2 text-[12px] ${sharing ? "btn-primary" : "btn-ghost"}`} onClick={() => void call.toggleScreen()} aria-pressed={sharing}>
          <MonitorUp size={15} /> {sharing ? "Parar tela" : "Tela"}
        </button>
      </div>
      {call.error && <p className="mt-2 text-[11px] leading-snug text-warn">{call.error}</p>}
    </div>
  );
}

export function UserBar({ onSettings }: { onSettings: () => void }) {
  const user = useSession((s) => s.user)!;
  const presence = useSession((s) => s.presence);
  const setPresence = useSession((s) => s.setPresence);
  const { channelId, muted, deafened, toggleMute, toggleDeafen } = useVoice();

  const choose = (p: Presence) => {
    setPresence(p);
    gateway.send("PRESENCE_UPDATE", { status: p });
  };

  return (
    <div className="shrink-0 bg-bg-0/40 pb-[var(--safe-bottom)]">
      {channelId && <VoicePanel />}
      <div className="flex items-center gap-1 px-2 py-2">
        <Menu>
          <MenuTrigger className="row h-11 min-w-0 flex-1 gap-2.5 px-1.5" aria-label="Mudar status">
            <Avatar user={user} size={32} status={presence} ring="ring-bg-1" />
            <span className="min-w-0 text-left leading-tight">
              <span className="block truncate text-[13px] font-semibold text-ink-1">{user.username}</span>
              <span className="block truncate text-[11px] text-ink-3">{presenceLabel(presence)}</span>
            </span>
          </MenuTrigger>
          <MenuContent side="top">
            {STATUSES.map((p) => (
              <MenuItem key={p} onSelect={() => choose(p)} icon={<PresenceDot status={p} ring="ring-transparent" />}>
                {p === "offline" ? "Invisível" : presenceLabel(p)}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
        <Tip label={muted ? "Ligar microfone" : "Silenciar"}>
          <button className={`icon-btn ${muted ? "!text-danger" : ""}`} onClick={toggleMute} aria-pressed={muted} aria-label={muted ? "Ligar microfone" : "Silenciar microfone"}>
            {muted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
        </Tip>
        <Tip label={deafened ? "Voltar a ouvir" : "Ensurdecer"}>
          <button className={`icon-btn ${deafened ? "!text-danger" : ""}`} onClick={toggleDeafen} aria-pressed={deafened} aria-label={deafened ? "Voltar a ouvir" : "Ensurdecer"}>
            {deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
          </button>
        </Tip>
        <Tip label="Configurações">
          <button className="icon-btn" onClick={onSettings} aria-label="Configurações do usuário">
            <Settings size={18} />
          </button>
        </Tip>
      </div>
    </div>
  );
}
