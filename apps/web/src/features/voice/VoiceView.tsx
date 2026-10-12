import { useEffect, useRef } from "react";
import { HeadphoneOff, Headphones, Mic, MicOff, MonitorUp, PhoneOff, Video, VideoOff, Volume2 } from "lucide-react";
import type { UserLite } from "../../lib/api";
import { useLive, useSession, useVoice } from "../../lib/store";
import { Avatar, Tip } from "../../components/ui";
import { useCall } from "./VoiceProvider";

export function MediaVideo({ stream, mirror = false, contain = false }: { stream: MediaStream; mirror?: boolean; contain?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className={`h-full w-full ${contain ? "object-contain" : "object-cover"} ${mirror ? "-scale-x-100" : ""}`} />;
}

interface Tile {
  user: UserLite;
  speaking: boolean;
  muted: boolean;
  deaf: boolean;
  cam: MediaStream | null;
  self: boolean;
}

function PersonTile({ t }: { t: Tile }) {
  const hasVideo = Boolean(t.cam?.getVideoTracks().length);
  return (
    <div className={`relative flex aspect-video min-h-0 items-center justify-center overflow-hidden rounded-xl bg-bg-3 ring-1 ring-inset transition-shadow duration-150 ${t.speaking ? "ring-2 ring-online" : "ring-white/[0.07]"}`}>
      {hasVideo ? <MediaVideo stream={t.cam!} mirror={t.self} /> : <Avatar user={t.user} size={72} speaking={t.speaking} />}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/55 px-2 py-1 text-[12px] font-medium text-white backdrop-blur">
        {t.deaf ? <HeadphoneOff size={13} className="text-danger" /> : t.muted ? <MicOff size={13} className="text-danger" /> : null}
        {t.user.username}
        {t.self && <span className="text-white/60">(você)</span>}
      </div>
    </div>
  );
}

export function VoiceStage({ channelId, people }: { channelId: string; people: Map<string, UserLite> }) {
  const call = useCall();
  const me = useSession((s) => s.user)!;
  const { muted, deafened, video, sharing, toggleMute, toggleDeafen, leave } = useVoice();
  const voice = useLive((s) => s.voice);

  const inChannel = Object.values(voice).filter((v) => v.channelId === channelId);
  const tiles: Tile[] = [
    { user: me, speaking: call.selfSpeaking && !muted, muted: muted || call.serverMuted, deaf: deafened, cam: call.localCam, self: true },
    ...inChannel
      .filter((v) => v.userId !== me.id)
      .map((v) => ({
        user: people.get(v.userId) ?? { id: v.userId, username: "…", avatarUrl: null },
        speaking: Boolean(call.remotes[v.userId]?.speaking ?? v.speaking) && !v.mute,
        muted: v.mute,
        deaf: v.deaf,
        cam: call.remotes[v.userId]?.cam ?? null,
        self: false,
      })),
  ];
  const screens = [
    ...(call.localScreen ? [{ id: me.id, name: "Sua tela", stream: call.localScreen }] : []),
    ...Object.values(call.remotes)
      .filter((r) => r.screen)
      .map((r) => ({ id: r.userId, name: `Tela de ${people.get(r.userId)?.username ?? "…"}`, stream: r.screen! })),
  ];
  const cols = tiles.length <= 1 ? "grid-cols-1" : tiles.length <= 4 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 lg:grid-cols-3";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg-0">
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
        {screens.length > 0 && (
          <div className="mb-3 space-y-3">
            {screens.map((s) => (
              <div key={s.id} className="relative aspect-video overflow-hidden rounded-xl bg-black ring-1 ring-inset ring-white/[0.08]">
                <MediaVideo stream={s.stream} contain />
                <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-md bg-live px-2 py-0.5 text-[11px] font-bold text-white">AO VIVO · {s.name}</span>
              </div>
            ))}
          </div>
        )}
        <div className={`mx-auto grid max-w-5xl gap-3 ${cols} ${screens.length ? "lg:grid-cols-4" : ""}`}>
          {tiles.map((t) => <PersonTile key={t.user.id} t={t} />)}
        </div>
        {call.error && <p className="mx-auto mt-4 max-w-md rounded-lg bg-warn/10 px-3 py-2 text-center text-[13px] text-warn ring-1 ring-inset ring-warn/25">{call.error}</p>}
      </div>
      <div className="flex shrink-0 items-center justify-center gap-2 border-t border-line bg-bg-1/80 px-3 pb-[calc(12px+var(--safe-bottom))] pt-3 backdrop-blur-xl">
        <Tip label={muted ? "Ligar microfone" : "Silenciar"}>
          <button onClick={toggleMute} aria-pressed={muted} aria-label="Microfone" className={`grid h-12 w-12 place-items-center rounded-full transition-[background-color,transform] duration-150 active:scale-95 ${muted ? "bg-danger text-white" : "bg-bg-4 text-ink-1 hover:bg-white/[0.14]"}`}>
            {muted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
        </Tip>
        <Tip label={deafened ? "Voltar a ouvir" : "Ensurdecer"}>
          <button onClick={toggleDeafen} aria-pressed={deafened} aria-label="Áudio" className={`grid h-12 w-12 place-items-center rounded-full transition-[background-color,transform] duration-150 active:scale-95 ${deafened ? "bg-danger text-white" : "bg-bg-4 text-ink-1 hover:bg-white/[0.14]"}`}>
            {deafened ? <HeadphoneOff size={20} /> : <Headphones size={20} />}
          </button>
        </Tip>
        <Tip label={video ? "Desligar câmera" : "Ligar câmera"}>
          <button onClick={() => void call.toggleCamera()} aria-pressed={video} aria-label="Câmera" className={`grid h-12 w-12 place-items-center rounded-full transition-[background-color,transform] duration-150 active:scale-95 ${video ? "bg-ink-1 text-bg-0" : "bg-bg-4 text-ink-1 hover:bg-white/[0.14]"}`}>
            {video ? <Video size={20} /> : <VideoOff size={20} />}
          </button>
        </Tip>
        <Tip label={sharing ? "Parar de transmitir" : "Transmitir tela"}>
          <button onClick={() => void call.toggleScreen()} aria-pressed={sharing} aria-label="Transmitir tela" className={`hidden h-12 w-12 place-items-center rounded-full transition-[background-color,transform] duration-150 active:scale-95 sm:grid ${sharing ? "bg-volt text-volt-ink" : "bg-bg-4 text-ink-1 hover:bg-white/[0.14]"}`}>
            <MonitorUp size={20} />
          </button>
        </Tip>
        <Tip label="Sair da chamada">
          <button onClick={leave} aria-label="Sair da chamada" className="grid h-12 w-16 place-items-center rounded-full bg-danger text-white transition-transform duration-150 active:scale-95">
            <PhoneOff size={20} />
          </button>
        </Tip>
      </div>
    </div>
  );
}

/** Canal de voz aberto mas sem estar nele: quem está lá + botão de entrar. */
export function VoiceLobby({ title, channelId, people, onJoin }: { title: string; channelId: string; people: Map<string, UserLite>; onJoin: () => void }) {
  const voice = useLive((s) => s.voice);
  const inside = Object.values(voice).filter((v) => v.channelId === channelId);
  return (
    <div className="relative grid min-h-0 flex-1 place-items-center overflow-hidden bg-bg-0 px-6">
      <div aria-hidden className="absolute left-1/2 top-1/2 h-[380px] w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-volt/[0.07] blur-[100px]" />
      <div className="relative text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-bg-3 text-volt ring-1 ring-inset ring-white/[0.08]"><Volume2 size={28} /></div>
        <h2 className="mt-4 font-display text-[22px] font-bold tracking-tight">{title}</h2>
        <p className="mt-1.5 text-[14px] text-ink-3">{inside.length ? `${inside.length} ${inside.length === 1 ? "pessoa" : "pessoas"} na chamada` : "Ninguém por aqui ainda. Puxa a fila."}</p>
        {inside.length > 0 && (
          <div className="mt-4 flex justify-center -space-x-2">
            {inside.slice(0, 6).map((v) => <span key={v.userId} className="rounded-full ring-4 ring-bg-0"><Avatar user={people.get(v.userId) ?? { id: v.userId, username: "?" }} size={36} speaking={v.speaking} /></span>)}
          </div>
        )}
        <button className="btn btn-primary mt-7 h-11 px-6" onClick={onJoin}>Entrar na chamada</button>
      </div>
    </div>
  );
}
