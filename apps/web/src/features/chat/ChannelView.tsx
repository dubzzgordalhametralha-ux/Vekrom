import { useEffect, useState } from "react";
import { Hash, Megaphone, Menu as MenuIcon, UserPlus, Users } from "lucide-react";
import { api, type Channel, type Message, type Server } from "../../lib/api";
import { can, PERM } from "../../lib/permissions";
import { mapMessages, viewing } from "../../lib/realtime";
import { toastError, useLive, useSession } from "../../lib/store";
import { gateway } from "../../lib/ws";
import { MessageSkeleton, Tip } from "../../components/ui";
import { Composer } from "./Composer";
import { MessageList, type ChatItem } from "./MessageList";
import { useHistory } from "./useHistory";

export function ChatHeader({ children, onMenu, actions }: { children: React.ReactNode; onMenu?: () => void; actions?: React.ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-bg-2/80 px-2 pt-[var(--safe-top)] backdrop-blur-xl [box-sizing:content-box] sm:px-4 md:pt-0">
      {onMenu && (
        <button className="icon-btn md:hidden" onClick={onMenu} aria-label="Abrir servidores e canais">
          <MenuIcon size={20} />
        </button>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      <div className="flex items-center gap-0.5">{actions}</div>
    </header>
  );
}

export function ChannelView({
  server,
  channel,
  showMembers,
  onToggleMembers,
  onMenu,
  onInvite,
  onProfile,
}: {
  server: Server;
  channel: Channel;
  showMembers: boolean;
  onToggleMembers: () => void;
  onMenu: () => void;
  onInvite: () => void;
  onProfile: (userId: string) => void;
}) {
  const user = useSession((s) => s.user)!;
  const key = ["messages", channel.id];
  const h = useHistory<Message>(key, (before) => api.messages(channel.id, before));
  const [editLast, setEditLast] = useState(0);

  useEffect(() => {
    viewing.channelId = channel.id;
    useLive.setState((s) => {
      if (!s.unread[channel.id]) return s;
      const unread = { ...s.unread };
      delete unread[channel.id];
      return { unread };
    });
    return () => {
      if (viewing.channelId === channel.id) viewing.channelId = null;
    };
  }, [channel.id]);

  const send = (content: string, attachments: Message["attachments"]) =>
    h.sendOptimistic(
      { channelId: channel.id, authorId: user.id, author: user, content, attachments, editedAt: null, reactions: [] },
      () => api.sendMessage(channel.id, content, attachments),
    );

  const Icon = channel.type === "announcement" ? Megaphone : Hash;
  const intro = (
    <div className="px-4 pb-4 pt-12">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-bg-3 text-ink-2 ring-1 ring-inset ring-white/[0.08]">
        <Icon size={30} />
      </div>
      <h2 className="mt-4 font-display text-[26px] font-bold tracking-tight [text-wrap:balance]">Bem-vindo a #{channel.name}</h2>
      <p className="mt-1.5 text-[14px] text-ink-3">{channel.topic || `Aqui começa o canal #${channel.name}. Manda a primeira.`}</p>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <ChatHeader
        onMenu={onMenu}
        actions={
          <>
            <Tip label="Convidar pessoas">
              <button className="icon-btn" onClick={onInvite} aria-label="Convidar pessoas">
                <UserPlus size={19} />
              </button>
            </Tip>
            <Tip label={showMembers ? "Esconder membros" : "Mostrar membros"}>
              <button className="icon-btn" data-active={showMembers} onClick={onToggleMembers} aria-pressed={showMembers} aria-label="Lista de membros">
                <Users size={19} />
              </button>
            </Tip>
          </>
        }
      >
        <Icon size={19} className="text-ink-4" />
        <h1 className="truncate text-[15px] font-semibold">{channel.name}</h1>
        {channel.topic && <span className="hidden truncate border-l border-line pl-3 text-[13px] text-ink-3 lg:block">{channel.topic}</span>}
      </ChatHeader>

      {h.isPending ? (
        <div className="min-h-0 flex-1 overflow-hidden"><MessageSkeleton /></div>
      ) : (
        <MessageList
          resetKey={channel.id}
          items={h.items as ChatItem[]}
          me={user}
          intro={intro}
          hasOlder={Boolean(h.hasNextPage)}
          fetchingOlder={h.isFetchingNextPage}
          loadOlder={() => void h.fetchNextPage()}
          canDeleteAny={can(server.permissions, PERM.MANAGE_MESSAGES)}
          editLastSignal={editLast}
          onProfile={onProfile}
          onEdit={(m, content) => {
            mapMessages<Message>(h.qc, key, (x) => (x.id === m.id ? { ...x, content, editedAt: new Date().toISOString() } : x));
            api.editMessage(m.id, content).catch(toastError);
          }}
          onDelete={(m) => {
            if (m.failed) return mapMessages<Message>(h.qc, key, (x) => (x.id === m.id ? null : x));
            mapMessages<Message>(h.qc, key, (x) => (x.id === m.id ? null : x));
            api.deleteMessage(m.id).catch((e) => {
              toastError(e);
              void h.refetch();
            });
          }}
          onReact={(m, emoji, on) => {
            const already = m.reactions?.find((r) => r.emoji === emoji)?.me;
            if (on && already) on = false; // clicar de novo tira
            mapMessages<Message>(h.qc, key, (x) => {
              if (x.id !== m.id) return x;
              const list = x.reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count + (on ? 1 : -1), me: on } : r)).filter((r) => r.count > 0);
              if (on && !list.some((r) => r.emoji === emoji)) list.push({ emoji, count: 1, me: true });
              return { ...x, reactions: list };
            });
            api.react(m.id, emoji, on).catch(toastError);
          }}
          onRetry={(m) => {
            mapMessages<Message>(h.qc, key, (x) => (x.id === m.id ? null : x));
            void send(m.content, m.attachments);
          }}
        />
      )}

      <Composer
        channelKey={channel.id}
        placeholder={`Conversar em #${channel.name}`}
        onSend={send}
        onTyping={() => gateway.send("TYPING_START", { channelId: channel.id })}
        onEditLast={() => setEditLast(Date.now())}
      />
    </div>
  );
}
