import { useCallback, useEffect, useRef, useState } from "react";
import { gateway } from "./lib/ws";
import { api } from "./lib/api";
import { useSession, useVoice } from "./lib/store";

/**
 * Mesh WebRTC (P2P) com sinalização via gateway (VOICE_SIGNAL).
 * - Câmera+mic: getUserMedia; tela: getDisplayMedia
 * - 1 RTCPeerConnection por par (scope "cam") + 1 por tela (scope "screen")
 * - Quem entra no canal oferta "cam" p/ quem já está; quem inicia a tela oferta "screen"
 * - ICE vem da API (/voice/ice): STUN + TURN com credencial temporária quando o coturn estiver ligado
 */

const ICE: RTCConfiguration = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
async function loadIce() {
  try {
    ICE.iceServers = await api.ice();
  } catch {
    /* fica só com STUN */
  }
}
type Scope = "cam" | "screen";

export interface RemotePeer {
  userId: string;
  cam: MediaStream | null;
  screen: MediaStream | null;
  camera: boolean;
  sharing: boolean;
  muted: boolean;
  speaking: boolean;
}

const emptyPeer = (userId: string): RemotePeer => ({
  userId, cam: null, screen: null, camera: false, sharing: false, muted: false, speaking: false,
});

interface SignalData {
  sdp?: RTCSessionDescriptionInit;
  ice?: RTCIceCandidateInit;
}

export interface ScreenShareOptions {
  displaySurface?: "browser" | "window" | "monitor";
  width?: number;
  frameRate?: number;
  withAudio?: boolean;
}

export function useVoiceCall(channelId: string | null) {
  const userId = useSession((s) => s.user?.id ?? null);
  const [localCam, setLocalCam] = useState<MediaStream | null>(null);
  const [localScreen, setLocalScreen] = useState<MediaStream | null>(null);
  const [remotes, setRemotes] = useState<Record<string, RemotePeer>>({});
  const [error, setError] = useState("");
  const [started, setStarted] = useState(false);
  const [selfSpeaking, setSelfSpeaking] = useState(false);
  const [serverMuted, setServerMuted] = useState(false);
  const [serverDeafened, setServerDeafened] = useState(false);

  const pcs = useRef(new Map<string, RTCPeerConnection>());
  const peers = useRef(new Set<string>());
  const localRef = useRef<{ cam: MediaStream | null; screen: MediaStream | null }>({ cam: null, screen: null });
  const uidRef = useRef(userId);
  uidRef.current = userId;
  const chanRef = useRef<string | null>(channelId);
  chanRef.current = channelId;
  const speakTimer = useRef<number | null>(null);
  const lastSpeaking = useRef(false);
  const lastSpeechAt = useRef(0);
  const speechContext = useRef<AudioContext | null>(null);
  const startedRef = useRef(false);
  const serverMutedRef = useRef(false);
  const startGen = useRef(0);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [previewLabel, setPreviewLabel] = useState("");
  const previewRef = useRef<MediaStream | null>(null);

  // Must be called directly from a user gesture (the voice-channel click).
  // Creating the context later in an effect can leave it suspended by autoplay policy.
  const prepareSpeechContext = useCallback(async () => {
    let ctx = speechContext.current;
    if (!ctx || ctx.state === "closed") {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctx();
      speechContext.current = ctx;
    }
    if (ctx.state !== "running") await ctx.resume().catch(() => undefined);
  }, []);

  const setRemote = useCallback((id: string, patch: Partial<RemotePeer>) => {
    setRemotes((r) => ({ ...r, [id]: { ...emptyPeer(id), ...r[id], ...patch } }));
  }, []);

  const signal = useCallback((to: string, scope: Scope, data: SignalData) => {
    gateway.send("VOICE_SIGNAL", { to, scope, data });
  }, []);

  const attachRemote = useCallback((peerId: string, scope: Scope, track: MediaStreamTrack) => {
    setRemotes((r) => {
      const prev = r[peerId] ?? emptyPeer(peerId);
      const prevStream = scope === "cam" ? prev.cam : prev.screen;
      const tracks = prevStream ? [...prevStream.getTracks()] : [];
      if (!tracks.some((t) => t.id === track.id)) {
        tracks.push(track);
      }
      const stream = new MediaStream(tracks);
      track.onended = () =>
        setRemotes((rr) => {
          const p = rr[peerId];
          if (!p) return rr;
          const s = scope === "cam" ? p.cam : p.screen;
          if (!s) return rr;
          const rem = s.getTracks().filter((t) => t.id !== track.id);
          return { ...rr, [peerId]: { ...p, [scope]: rem.length > 0 ? new MediaStream(rem) : null } };
        });
      return { ...r, [peerId]: { ...prev, [scope]: stream } };
    });
  }, []);

  const makePC = useCallback((peerId: string, scope: Scope): RTCPeerConnection => {
    const key = `${scope}:${peerId}`;
    const pc = new RTCPeerConnection(ICE);
    pcs.current.set(key, pc);
    pc.onicecandidate = (e) => {
      if (e.candidate) signal(peerId, scope, { ice: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      const track = e.track;
      if (scope === "cam" || track.kind === "video") attachRemote(peerId, scope, track);
      else attachRemote(peerId, scope, track);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        pcs.current.delete(key);
      }
    };
    // Trilhas locais
    if (scope === "cam" && localRef.current.cam) {
      for (const t of localRef.current.cam.getTracks()) pc.addTrack(t, localRef.current.cam);
    }
    if (scope === "screen" && localRef.current.screen) {
      for (const t of localRef.current.screen.getTracks()) pc.addTrack(t, localRef.current.screen);
    }
    return pc;
  }, [attachRemote, signal]);

  const offerTo = useCallback(async (peerId: string, scope: Scope) => {
    if (peerId === uidRef.current) return;
    const key = `${scope}:${peerId}`;
    let pc = pcs.current.get(key);
    if (!pc) pc = makePC(peerId, scope);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    signal(peerId, scope, { sdp: { type: offer.type, sdp: offer.sdp } });
  }, [makePC, signal]);

  const handleSignal = useCallback(async (from: string, scope: Scope, data: SignalData) => {
    const key = `${scope}:${from}`;
    let pc = pcs.current.get(key);
    try {
      if (data.sdp) {
        if (data.sdp.type === "offer") {
          // Glare: se já ofertei e o id dele é maior, a oferta dele vence
          if (pc && pc.signalingState !== "stable") {
            if (from > (uidRef.current ?? "")) {
              pc.close();
              pcs.current.delete(key);
              pc = undefined;
            } else {
              return; // ignora: minha oferta vence
            }
          }
          if (!pc) pc = makePC(from, scope);
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          signal(from, scope, { sdp: { type: answer.type, sdp: answer.sdp } });
        } else if (data.sdp.type === "answer") {
          if (pc && pc.signalingState !== "stable") {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          }
        }
      } else if (data.ice) {
        if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.ice)).catch(() => undefined);
      }
    } catch {
      /* sinalização best-effort */
    }
  }, [makePC, signal]);

  const closePeer = useCallback((peerId: string) => {
    for (const scope of ["cam", "screen"] as Scope[]) {
      const key = `${scope}:${peerId}`;
      pcs.current.get(key)?.close();
      pcs.current.delete(key);
    }
    peers.current.delete(peerId);
    setRemotes((r) => {
      const next = { ...r };
      delete next[peerId];
      return next;
    });
  }, []);

  // Monitor de fala local (RMS do mic) → avisa falando/não-falando
  const watchSpeaking = useCallback((stream: MediaStream, ctx: AudioContext) => {
    try {
      if (speakTimer.current !== null) window.clearInterval(speakTimer.current);
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.15;
      src.connect(analyser);
      const silentOutput = ctx.createGain();
      silentOutput.gain.value = 0;
      analyser.connect(silentOutput);
      silentOutput.connect(ctx.destination);
      const buf = new Float32Array(analyser.fftSize);
      speakTimer.current = window.setInterval(() => {
        const ch = chanRef.current;
        if (!ch) return;
        // Permission prompts can suspend audio contexts on some browsers.
        if (ctx.state !== "running") void ctx.resume().catch(() => undefined);
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          sum += buf[i] * buf[i];
        }
        const rms = Math.sqrt(sum / buf.length);
        const now = performance.now();
        const aboveThreshold = rms > (lastSpeaking.current ? 0.006 : 0.009);
        if (aboveThreshold) lastSpeechAt.current = now;
        // Ativa no primeiro bloco de voz e segura brevemente o estado ao fim das sílabas.
        const speaking = aboveThreshold || (lastSpeaking.current && now - lastSpeechAt.current < 180);
        if (speaking !== lastSpeaking.current) {
          lastSpeaking.current = speaking;
          setSelfSpeaking(speaking);
          gateway.send("VOICE_STATE_UPDATE", { channelId: chanRef.current, speaking });
        }
      }, 30);
    } catch {
      /* sem analyser: sem indicador */
    }
  }, []);

  const start = useCallback(async () => {
    if (!uidRef.current || startedRef.current || !chanRef.current) return;
    startedRef.current = true;
    setError("");
    const gen = ++startGen.current;
    let ctx: AudioContext | null = null;
    try {
      // Create and resume the analyser during the join click, before the
      // microphone permission prompt can consume the browser's user activation.
      await prepareSpeechContext();
      await loadIce();
      ctx = speechContext.current;
      if (!ctx || ctx.state === "closed") throw new Error("AudioContext unavailable");
      const cam = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (gen !== startGen.current) {
        cam.getTracks().forEach((t) => t.stop());
        void ctx.close().catch(() => undefined);
        return;
      }
      localRef.current.cam = cam;
      cam.getAudioTracks().forEach((t) => {
        t.enabled = !useVoice.getState().muted && !serverMutedRef.current;
      });
      setLocalCam(new MediaStream(cam.getTracks()));
      useVoice.getState().setVideo(false);
      watchSpeaking(cam, ctx);
      setStarted(true);
      gateway.send("VOICE_STATE_UPDATE", { channelId: chanRef.current, camera: false, sharing: false, mute: useVoice.getState().muted, deaf: useVoice.getState().deafened });
    } catch {
      startedRef.current = false;
      if (ctx) void ctx.close().catch(() => undefined);
      if (speechContext.current === ctx) speechContext.current = null;
      setError("Sem acesso ao microfone: você entrou só para ouvir. Libere o microfone no navegador para falar.");
      // Entra mesmo assim, mudo (dá para ouvir e ver telas).
      if (!useVoice.getState().muted) useVoice.setState({ muted: true });
      gateway.send("VOICE_STATE_UPDATE", { channelId: chanRef.current, mute: true, deaf: useVoice.getState().deafened });
    }
  }, [prepareSpeechContext, watchSpeaking]);

  /** Liga/desliga o microfone sem sair da chamada. */
  const setMicrophone = useCallback((muted: boolean) => {
    localRef.current.cam?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }, []);

  const toggleCamera = useCallback(async () => {
    const isVideoOn = useVoice.getState().video;
    if (isVideoOn) {
      // Desliga câmera: interrompe o hardware e remove as tracks de vídeo
      const stream = localRef.current.cam;
      if (stream) {
        stream.getVideoTracks().forEach((track) => {
          track.stop();
          stream.removeTrack(track);
        });
        setLocalCam(new MediaStream(stream.getTracks()));
      }
      for (const [key, pc] of pcs.current) {
        if (key.startsWith("cam:")) {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video");
          if (sender) {
            try {
              pc.removeTrack(sender);
            } catch { /* noop */ }
          }
        }
      }
      useVoice.getState().setVideo(false);
      gateway.send("VOICE_STATE_UPDATE", { channelId: chanRef.current, camera: false });
      for (const peerId of peers.current) {
        if (peerId !== uidRef.current) {
          void offerTo(peerId, "cam");
        }
      }
    } else {
      // Liga câmera: solicita permissão ao usuário somente agora ao clicar no botão
      setError("");
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 } },
        });
        const videoTrack = videoStream.getVideoTracks()[0];
        if (!videoTrack) return;

        if (!localRef.current.cam) {
          localRef.current.cam = new MediaStream();
        }
        localRef.current.cam.addTrack(videoTrack);
        setLocalCam(new MediaStream(localRef.current.cam.getTracks()));

        // Adiciona ou substitui a trilha de vídeo nos RTCPeerConnection ativos
        for (const [key, pc] of pcs.current) {
          if (key.startsWith("cam:")) {
            const sender = pc.getSenders().find((s) => s.track?.kind === "video");
            if (sender) {
              await sender.replaceTrack(videoTrack);
            } else {
              pc.addTrack(videoTrack, localRef.current.cam);
            }
          }
        }

        useVoice.getState().setVideo(true);
        gateway.send("VOICE_STATE_UPDATE", { channelId: chanRef.current, camera: true });

        for (const peerId of peers.current) {
          if (peerId !== uidRef.current) {
            void offerTo(peerId, "cam");
          }
        }

        videoTrack.onended = () => {
          if (useVoice.getState().video) {
            void toggleCamera();
          }
        };
      } catch {
        setError("Não foi possível acessar a câmera. Verifique as permissões do navegador.");
      }
    }
  }, [offerTo]);

  const stop = useCallback((keepSpeechContext = false) => {
    startGen.current++;
    startedRef.current = false;
    if (speakTimer.current !== null) {
      window.clearInterval(speakTimer.current);
      speakTimer.current = null;
    }
    if (!keepSpeechContext) {
      void speechContext.current?.close().catch(() => undefined);
      speechContext.current = null;
    }
    for (const pc of pcs.current.values()) {
      try { pc.close(); } catch { /* noop */ }
    }
    pcs.current.clear();
    peers.current.clear();
    localRef.current.cam?.getTracks().forEach((t) => t.stop());
    localRef.current.screen?.getTracks().forEach((t) => t.stop());
    previewRef.current?.getTracks().forEach((t) => t.stop());
    previewRef.current = null;
    setPreviewStream(null);
    setPreviewLabel("");
    localRef.current = { cam: null, screen: null };
    setLocalCam(null);
    setLocalScreen(null);
    setRemotes({});
    setStarted(false);
    lastSpeaking.current = false;
    lastSpeechAt.current = 0;
    setSelfSpeaking(false);
    useVoice.getState().setVideo(false);
    useVoice.getState().setSharing(false);
  }, []);

  /** Para a transmissão de tela e fecha as conexões de tela. */
  const stopScreen = useCallback(() => {
    localRef.current.screen?.getTracks().forEach((t) => t.stop());
    localRef.current.screen = null;
    for (const [key, pc] of pcs.current) {
      if (key.startsWith("screen:")) {
        try { pc.close(); } catch { /* noop */ }
        pcs.current.delete(key);
      }
    }
    setLocalScreen(null);
    useVoice.getState().setSharing(false);
    gateway.send("VOICE_STATE_UPDATE", { channelId: chanRef.current, sharing: false });
  }, []);

  /** Captura a tela (abre o seletor do navegador). Retorna stream + nome real da superfície. */
  const captureScreen = useCallback(async (
    opts: ScreenShareOptions = {},
  ): Promise<{ stream: MediaStream; label: string } | null> => {
    try {
      const constraints: DisplayMediaStreamOptions = {
        video: {
          width: { ideal: opts.width ?? 1280 },
          frameRate: opts.frameRate ? { ideal: opts.frameRate, max: 60 } : { ideal: 30, max: 60 },
          ...(opts.displaySurface ? { displaySurface: opts.displaySurface } : {}),
        } as MediaTrackConstraints,
        audio: opts.withAudio ?? false,
        selfBrowserSurface: "include",
        surfaceSwitching: "include",
        systemAudio: opts.withAudio ? "include" : "exclude",
      } as DisplayMediaStreamOptions;
      const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
      const label = stream.getVideoTracks()[0]?.label || "Tela selecionada";
      return { stream, label };
    } catch {
      return null;
    }
  }, []);

  /** Passo 1: captura e mostra a prévia no modal (ainda NÃO transmite). */
  const previewScreen = useCallback(async (opts: ScreenShareOptions = {}): Promise<boolean> => {
    if (previewRef.current) return true;
    setError("");
    const cap = await captureScreen(opts);
    if (!cap) return false;
    previewRef.current = cap.stream;
    setPreviewStream(cap.stream);
    setPreviewLabel(cap.label);
    cap.stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      cancelPreviewRef.current();
    });
    return true;
  }, [captureScreen]);

  /** Cancela a prévia sem transmitir. */
  const cancelPreview = useCallback(() => {
    previewRef.current?.getTracks().forEach((t) => t.stop());
    previewRef.current = null;
    setPreviewStream(null);
    setPreviewLabel("");
  }, []);
  const cancelPreviewRef = useRef(cancelPreview);
  cancelPreviewRef.current = cancelPreview;

  /** Passo 2: confirma a prévia e entra ao vivo para os participantes. */
  const confirmPreview = useCallback(async (): Promise<boolean> => {
    const stream = previewRef.current;
    if (!stream || useVoice.getState().sharing || !chanRef.current) return false;
    previewRef.current = null;
    setPreviewStream(null);
    localRef.current.screen = stream;
    setLocalScreen(stream);
    useVoice.getState().setSharing(true);
    gateway.send("VOICE_STATE_UPDATE", { channelId: chanRef.current, sharing: true });
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      stopScreen();
    });
    for (const peerId of peers.current) {
      if (peerId !== uidRef.current) await offerTo(peerId, "screen");
    }
    return true;
  }, [offerTo, stopScreen]);

  /** Inicia a transmissão de tela com as opções escolhidas. Retorna true se iniciou. */
  const shareScreen = useCallback(async (opts: ScreenShareOptions = {}): Promise<boolean> => {
    if (useVoice.getState().sharing || !chanRef.current) return useVoice.getState().sharing;
    setError("");
    const cap = await captureScreen(opts);
    if (!cap) return false;
    const screen = cap.stream;
    localRef.current.screen = screen;
    setLocalScreen(screen);
    useVoice.getState().setSharing(true);
    gateway.send("VOICE_STATE_UPDATE", { channelId: chanRef.current, sharing: true });
    screen.getVideoTracks()[0]?.addEventListener("ended", () => {
      stopScreen();
    });
    for (const peerId of peers.current) {
      if (peerId !== uidRef.current) await offerTo(peerId, "screen");
    }
    return true;
  }, [captureScreen, offerTo, stopScreen]);

  const toggleScreen = useCallback(async (options?: { resolution?: string; frameRate?: string }) => {
    if (useVoice.getState().sharing) {
      stopScreen();
      return;
    }
    await shareScreen({
      width: options?.resolution === "1080" ? 1920 : 1280,
      frameRate: options?.frameRate ? Number(options.frameRate) : 30,
    });
  }, [offerTo, shareScreen, stopScreen]);
  const toggleScreenRef = useRef(toggleScreen);
  toggleScreenRef.current = toggleScreen;

  // Eventos do gateway: membros, join/leave, flags e sinalização
  useEffect(() => {
    const off = gateway.subscribe((evt) => {
      if (evt.t === "voice:members") {
        const d = evt.d as { channelId: string; members: Array<{ userId: string }> };
        if (d.channelId !== chanRef.current) return;
        for (const m of d.members) {
          if (m.userId === uidRef.current || peers.current.has(m.userId)) continue;
          peers.current.add(m.userId);
          void offerTo(m.userId, "cam");
          if (localRef.current.screen) void offerTo(m.userId, "screen");
        }
      } else if (evt.t === "voice:update") {
        const vs = (evt.d as { voiceState: {
          userId: string; channelId: string | null;
          mute?: boolean; deaf?: boolean; camera?: boolean;
          sharing?: boolean; speaking?: boolean;
        } }).voiceState;
        if (!vs || vs.userId === uidRef.current) return;
        if (vs.channelId === chanRef.current) {
          peers.current.add(vs.userId);
          setRemote(vs.userId, {
            camera: vs.camera ?? false,
            sharing: vs.sharing ?? false,
            muted: vs.mute ?? false,
            speaking: vs.speaking ?? false,
          });
        } else {
          closePeer(vs.userId);
        }
      } else if (evt.t === "voice:signal") {
        const d = evt.d as { from: string; scope?: Scope; data: SignalData };
        if (d.from && d.data) void handleSignal(d.from, d.scope ?? "cam", d.data);
      } else if (evt.t === "VOICE_MODERATION") {
        const d = evt.d as { userId: string; voiceMuted?: boolean; soundMuted?: boolean };
        if (d.userId !== uidRef.current) return;
        if (d.voiceMuted !== undefined) {
          serverMutedRef.current = d.voiceMuted;
          setServerMuted(d.voiceMuted);
          localRef.current.cam?.getAudioTracks().forEach((track) => { track.enabled = !d.voiceMuted && !useVoice.getState().muted; });
          if (d.voiceMuted) {
            lastSpeaking.current = false;
            lastSpeechAt.current = 0;
            setSelfSpeaking(false);
            gateway.send("VOICE_STATE_UPDATE", { channelId: chanRef.current, speaking: false });
          }
        }
        if (d.soundMuted !== undefined) setServerDeafened(d.soundMuted);
      }
    });
    return off;
  }, [closePeer, handleSignal, offerTo, setRemote]);

  useEffect(() => () => {
    if (speakTimer.current !== null) window.clearInterval(speakTimer.current);
  }, []);

  useEffect(() => {
    const unsub = useVoice.subscribe((state) => {
      localRef.current.cam?.getAudioTracks().forEach((t) => {
        t.enabled = !state.muted && !serverMutedRef.current;
      });
      if (state.muted || serverMutedRef.current) {
        lastSpeaking.current = false;
        lastSpeechAt.current = 0;
        setSelfSpeaking(false);
        if (chanRef.current) gateway.send("VOICE_STATE_UPDATE", { channelId: chanRef.current, speaking: false });
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    for (const peer of Object.values(remotes)) {
      peer.cam?.getAudioTracks().forEach((track) => { track.enabled = !serverDeafened; });
    }
  }, [remotes, serverDeafened]);

  return { localCam, localScreen, remotes, error, started, selfSpeaking, serverMuted, serverDeafened, start, stop, prepareSpeechContext, setMicrophone, toggleCamera, toggleScreen, shareScreen, previewStream, previewLabel, previewScreen, confirmPreview, cancelPreview };
}
