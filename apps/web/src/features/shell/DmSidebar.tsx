import { Link } from "react-router-dom";
import { Plus, Users } from "lucide-react";
import { useConversations, useFriends, usePresence } from "../../lib/queries";
import type { Conversation } from "../../lib/api";
import { useLive } from "../../lib/store";
import { Avatar, Tip } from "../../components/ui";

function ConversationRow({ c, active, onNavigate }: { c: Conversation; active: boolean; onNavigate?: () => void }) {
  const status = usePresence(c.user.id, c.user.status);
  const unread = useLive((s) => Boolean(s.unread[`dm:${c.user.id}`]));
  return (
    <Link to={`/channels/@me/${c.user.id}`} onClick={onNavigate} data-active={active} className="row h-12 gap-3">
      <Avatar user={c.user} size={32} status={status} ring={active ? "ring-bg-4" : "ring-bg-1"} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[14px] ${unread ? "font-semibold text-ink-1" : ""}`}>{c.user.username}</span>
        <span className="block truncate text-[12px] text-ink-4">{c.lastMessage || "Anexo"}</span>
      </span>
      {unread && <span className="h-2 w-2 rounded-full bg-volt" aria-label="Não lida" />}
    </Link>
  );
}

export function DmSidebar({ activeUserId, onNavigate }: { activeUserId: string | null; onNavigate?: () => void }) {
  const { data: conversations, isPending } = useConversations();
  const { data: friends } = useFriends();
  const pending = (friends ?? []).filter((f) => f.status === "pending" && f.direction === "incoming").length;
  const friendsActive = activeUserId === "friends" || activeUserId === null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center border-b border-line px-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Mensagens diretas</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
        <Link to="/channels/@me/friends" onClick={onNavigate} data-active={friendsActive} className="row h-11 gap-3 text-[14px] font-medium">
          <Users size={19} className="ml-1.5" />
          <span className="flex-1">Amigos</span>
          {pending > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1.5 text-[11px] font-bold text-white">{pending}</span>}
        </Link>
        <div className="mt-4 flex items-center justify-between px-2">
          <span className="section-label">Conversas</span>
          <Tip label="Nova conversa">
            <Link to="/channels/@me/friends" onClick={onNavigate} className="icon-btn h-6 w-6" aria-label="Nova conversa">
              <Plus size={15} />
            </Link>
          </Tip>
        </div>
        <div className="mt-1 space-y-0.5">
          {isPending &&
            [0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-2">
                <div className="skeleton h-8 w-8 rounded-full" />
                <div className="skeleton h-3 flex-1 rounded" />
              </div>
            ))}
          {conversations?.map((c) => <ConversationRow key={c.user.id} c={c} active={c.user.id === activeUserId} onNavigate={onNavigate} />)}
          {conversations?.length === 0 && <p className="px-2 py-3 text-[13px] leading-relaxed text-ink-4">Nenhuma conversa ainda. Adicione amigos ou chame alguém de um servidor.</p>}
        </div>
      </div>
    </div>
  );
}
