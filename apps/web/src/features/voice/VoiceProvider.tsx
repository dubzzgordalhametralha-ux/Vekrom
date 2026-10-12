import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useVoiceCall } from "../../voice-call";
import { useVoice } from "../../lib/store";
import { gateway } from "../../lib/ws";

type Call = ReturnType<typeof useVoiceCall>;
const VoiceCallCtx = createContext<Call | null>(null);

/**
 * UMA chamada viva no app inteiro: navegar entre canais de texto não derruba a voz.
 * Trocar de canal de voz encerra a anterior e entra na nova.
 */
export function VoiceProvider({ children }: { children: ReactNode }) {
  const channelId = useVoice((s) => s.channelId);
  const call = useVoiceCall(channelId);
  const { start, stop } = call;

  useEffect(() => {
    if (!channelId) return;
    void start();
    return () => {
      stop(true);
      gateway.send("VOICE_STATE_UPDATE", { channelId: null });
    };
  }, [channelId, start, stop]);

  // Mute/ensurdecer viram estado visível para os outros.
  useEffect(
    () =>
      useVoice.subscribe((s, prev) => {
        if (s.channelId && (s.muted !== prev.muted || s.deafened !== prev.deafened)) {
          gateway.send("VOICE_STATE_UPDATE", { channelId: s.channelId, mute: s.muted, deaf: s.deafened });
        }
      }),
    [],
  );

  return (
    <VoiceCallCtx.Provider value={call}>
      {children}
      <AudioSink streams={Object.values(call.remotes).flatMap((r) => [r.cam, r.screen]).filter((s): s is MediaStream => Boolean(s))} />
    </VoiceCallCtx.Provider>
  );
}

/** Áudio dos outros fica montado sempre: dá para navegar pelo app sem cair o som. */
function AudioSink({ streams }: { streams: MediaStream[] }) {
  const deafened = useVoice((s) => s.deafened);
  return (
    <div hidden>
      {streams.map((s) => (
        <RemoteAudio key={s.id} stream={s} muted={deafened} />
      ))}
    </div>
  );
}

function RemoteAudio({ stream, muted }: { stream: MediaStream; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    void el.play().catch(() => undefined);
  }, [stream]);
  return <audio ref={ref} autoPlay muted={muted} />;
}

export function useCall(): Call {
  const ctx = useContext(VoiceCallCtx);
  if (!ctx) throw new Error("useCall fora do VoiceProvider");
  return ctx;
}
