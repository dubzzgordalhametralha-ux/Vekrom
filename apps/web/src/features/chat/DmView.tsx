import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Phone, PhoneIncoming } from "lucide-react";
import { api, type DirectMessage } from "../../lib/api";
import { usePresence } from "../../lib/queries";
import { mapMessages, viewing } from "../../lib/realtime";
import { dmCallId, useLive, useSession, useVoice } from "../../lib/store";
import { Avatar, MessageSkeleton, Tip, presenceLabel } from "../../components/ui";
import { useCall } from "../voice/VoiceProvider";
import { VoiceStage } from "../voice/VoiceView";
import { ChatHeader } from "./ChannelView";
import { Composer } from "./Composer";
import { MessageList, type ChatItem } from "./MessageList";
import { useHistory } from "./useHistory";

export function DmView({ userId, onMenu, onProfile }: { userId: string; onMenu: () => void; onProfile: (id: string) => void }) {
  const me = useSession((s) => s.user)!;
  const other = useQuery({ queryKey: ["user", userId], queryFn: () => api.user(userId) });
  const status = usePresence(userId, other.data?.status);
  const key = ["dms", userId];
  const h = useHistory<DirectMessage>(key, (before) => api.dms(userId, before));
  const callId = dmCallId(me.id, userId);
  const inCall = useVoice((s) => s.channelId === callId);
  const join = useVoice((s) => s.join);
  const call = useCall();
  const ringing = useLive((s) => s.voice[userId]?.channelId === callId);
  const people = useMemo(() => new Map([[userId, other.data ?? { id: userId, username: "…", avatarUrl: null }], [me.id, me]]), [userId, other.data, me]);

  useEffect(() => {
    viewing.dmUserId = userId;
    useLive.setState((s) => {
      const unread = { ...s.unread };
      delete unread[`dm:${userId}`];
      return { unread };
    });
    return () => {
      if (viewing.dmUserId === userId) viewing.dmUserId = null;
    };
  }, [userId]);

  const name = other.data?.username ?? "…";
  const startCall = () => {
    void call.prepareSpeechContext();
    join(callId, `Chamada com ${name}`);
  };
  const send = (content: string, attachments: DirectMessage["attachments"]) =>
    h.sendOptimistic({ senderId: me.id, recipientId: userId, author: me, content, attachments }, () => api.sendDm(userId, content, attachments));

  const items: ChatItem[] = h.items.map((m) => ({ ...m, authorId: m.senderId }));
  const intro = (
    <div className="px-4 pb-4 pt-12">
      {other.data && <Avatar user={other.data} size={72} />}
      <h2 className="mt-4 font-display text-[26px] font-bold tracking-tight">{name}</h2>
      <p className="mt-1.5 text-[14px] text-ink-3">Começo da sua conversa com <strong className="font-semibold text-ink-2">{name}</strong>.</p>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <ChatHeader
        onMenu={onMenu}
        actions={
          !inCall && (
            <Tip label="Ligar">
              <button className="icon-btn" onClick={startCall} aria-label={`Ligar para ${name}`}>
                <Phone size={19} />
              </button>
            </Tip>
          )
        }
      >
        <button className="flex min-w-0 items-center gap-2.5 rounded px-1 py-1 hover:bg-white/[0.04]" onClick={() => onProfile(userId)}>
          {other.data && <Avatar user={other.data} size={28} status={status} ring="ring-bg-2" />}
          <span className="min-w-0 text-left leading-tight">
            <span className="block truncate text-[15px] font-semibold">{name}</span>
            <span className="block text-[11px] text-ink-3">{presenceLabel(status)}</span>
          </span>
        </button>
      </ChatHeader>

      {inCall && (
        <div className="flex h-[min(52dvh,460px)] shrink-0 flex-col border-b border-line">
          <VoiceStage channelId={callId} people={people} />
        </div>
      )}
      {!inCall && ringing && (
        <div className="flex shrink-0 items-center gap-3 border-b border-line bg-online/[0.08] px-4 py-2.5">
          <PhoneIncoming size={18} className="text-online" />
          <span className="flex-1 text-[13px]"><strong className="font-semibold">{name}</strong> está na chamada com você.</span>
          <button className="btn btn-primary h-8 px-3 text-[13px]" onClick={startCall}>Entrar</button>
        </div>
      )}

      {h.isPending ? (
        <div className="min-h-0 flex-1 overflow-hidden"><MessageSkeleton /></div>
      ) : h.isError ? (
        <p className="p-6 text-[14px] text-ink-3">Não deu para abrir essa conversa.</p>
      ) : (
        <MessageList
          resetKey={userId}
          items={items}
          me={me}
          intro={intro}
          hasOlder={Boolean(h.hasNextPage)}
          fetchingOlder={h.isFetchingNextPage}
          loadOlder={() => void h.fetchNextPage()}
          onProfile={onProfile}
          onRetry={(m) => {
            mapMessages<DirectMessage>(h.qc, key, (x) => (x.id === m.id ? null : x));
            void send(m.content, m.attachments);
          }}
        />
      )}
      <Composer channelKey={`dm:${userId}`} placeholder={`Mensagem para @${name}`} onSend={send} />
    </div>
  );
}
