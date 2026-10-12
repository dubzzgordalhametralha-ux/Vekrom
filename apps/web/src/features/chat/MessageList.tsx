import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, Check, FileAudio, Pencil, SmilePlus, Trash2, X } from "lucide-react";
import type { Attachment, Reaction, UserLite } from "../../lib/api";
import { fmtDay, fmtStamp, fmtTime, sameDay } from "../../lib/format";
import { Markdown, mentions } from "../../lib/markdown";
import { Avatar, Menu, MenuContent, MenuTrigger, Spinner, Tip } from "../../components/ui";
import * as DM from "@radix-ui/react-dropdown-menu";

export interface ChatItem {
  id: string;
  authorId: string;
  author: UserLite;
  content: string;
  attachments: Attachment[];
  createdAt: string;
  editedAt?: string | null;
  reactions?: Reaction[];
  pending?: boolean;
  failed?: boolean;
}

export const QUICK_EMOJI = ["👍", "🔥", "😂", "❤️", "😮", "🎮"];
const GROUP_MS = 7 * 60_000;

function Attachments({ items }: { items: Attachment[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {items.map((a) =>
        a.contentType.startsWith("image/") ? (
          <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg ring-1 ring-inset ring-white/[0.08]">
            <img src={a.url} alt={a.name} loading="lazy" className="max-h-80 max-w-[min(100%,420px)] object-contain" />
          </a>
        ) : a.contentType.startsWith("video/") ? (
          <video key={a.url} src={a.url} controls preload="metadata" className="max-h-80 max-w-[min(100%,480px)] rounded-lg bg-black ring-1 ring-inset ring-white/[0.08]" />
        ) : (
          <div key={a.url} className="flex w-full max-w-sm items-center gap-3 rounded-lg bg-bg-3 p-3 ring-1 ring-inset ring-white/[0.07]">
            <FileAudio size={20} className="text-volt" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink-1">{a.name}</p>
              <audio src={a.url} controls preload="none" className="mt-2 h-8 w-full" />
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function Reactions({ list, onToggle }: { list: Reaction[]; onToggle?: (emoji: string, on: boolean) => void }) {
  if (!list.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {list.map((r) => (
        <button
          key={r.emoji}
          onClick={() => onToggle?.(r.emoji, !r.me)}
          aria-pressed={r.me}
          aria-label={`${r.emoji} ${r.count}`}
          className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] ring-1 ring-inset transition-[background-color,transform] duration-100 active:scale-95 ${
            r.me ? "bg-volt/[0.14] text-volt ring-volt/40" : "bg-white/[0.04] text-ink-2 ring-white/[0.08] hover:bg-white/[0.08]"
          }`}
        >
          <span>{r.emoji}</span>
          <span className="font-medium tabular-nums">{r.count}</span>
        </button>
      ))}
    </div>
  );
}

interface RowProps {
  item: ChatItem;
  grouped: boolean;
  me: { id: string; username: string };
  canDelete: boolean;
  editable: boolean;
  isNew: boolean;
  selected: boolean;
  editing: boolean;
  onSelect: (id: string | null) => void;
  onEditStart: (id: string) => void;
  onEditDone: (id: string, content: string | null) => void;
  onDelete?: (item: ChatItem) => void;
  onReact?: (item: ChatItem, emoji: string, on: boolean) => void;
  onRetry?: (item: ChatItem) => void;
  onProfile?: (userId: string) => void;
}

const Row = memo(function Row({ item, grouped, me, canDelete, editable, isNew, selected, editing, onSelect, onEditStart, onEditDone, onDelete, onReact, onRetry, onProfile }: RowProps) {
  const mine = item.authorId === me.id;
  const mentioned = !mine && mentions(item.content, me.username);
  const [draft, setDraft] = useState(item.content);
  useEffect(() => setDraft(item.content), [item.content, editing]);

  const toolbar = !item.pending && !item.failed && !editing && (
    <div
      className={`glass absolute -top-4 right-3 z-10 flex items-center gap-0.5 rounded-lg p-0.5 transition-opacity duration-100 ${selected ? "opacity-100" : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"}`}
    >
      {onReact &&
        QUICK_EMOJI.slice(0, 3).map((e) => (
          <button key={e} className="icon-btn h-8 w-8 text-[15px]" onClick={() => onReact(item, e, true)} aria-label={`Reagir com ${e}`}>
            {e}
          </button>
        ))}
      {onReact && (
        <Menu>
          <MenuTrigger className="icon-btn h-8 w-8" aria-label="Mais reações">
            <SmilePlus size={16} />
          </MenuTrigger>
          <MenuContent align="end">
            <div className="grid grid-cols-6 gap-1 p-1">
              {QUICK_EMOJI.map((e) => (
                <DM.Item key={e} onSelect={() => onReact(item, e, true)} className="grid h-9 w-9 cursor-default place-items-center rounded text-[18px] outline-none data-[highlighted]:bg-white/10">
                  {e}
                </DM.Item>
              ))}
            </div>
          </MenuContent>
        </Menu>
      )}
      {mine && editable && (
        <Tip label="Editar">
          <button className="icon-btn h-8 w-8" onClick={() => onEditStart(item.id)} aria-label="Editar mensagem">
            <Pencil size={15} />
          </button>
        </Tip>
      )}
      {canDelete && onDelete && (
        <Tip label="Apagar">
          <button className="icon-btn h-8 w-8 hover:!text-danger" onClick={() => onDelete(item)} aria-label="Apagar mensagem">
            <Trash2 size={15} />
          </button>
        </Tip>
      )}
    </div>
  );

  return (
    <div
      onClick={(e) => {
        if (window.matchMedia("(pointer: coarse)").matches && !(e.target as HTMLElement).closest("button,a,audio,video,textarea")) onSelect(selected ? null : item.id);
      }}
      className={`group relative flex gap-3.5 px-4 ${grouped ? "py-0.5" : "pt-3 pb-0.5"} ${isNew ? "msg-new" : ""} ${
        mentioned ? "bg-volt/[0.05] shadow-[inset_2px_0_0_rgb(var(--volt))]" : selected ? "bg-white/[0.035]" : "hover:bg-white/[0.02]"
      } ${item.pending ? "opacity-60" : ""}`}
    >
      <div className="w-10 shrink-0">
        {grouped ? (
          <span className="block pt-[3px] text-right text-[10px] tabular-nums text-ink-4 opacity-0 group-hover:opacity-100">{fmtTime(item.createdAt)}</span>
        ) : (
          <button className="mt-0.5 rounded-full transition-transform duration-150 active:scale-95" onClick={() => onProfile?.(item.authorId)} aria-label={`Perfil de ${item.author.username}`}>
            <Avatar user={item.author} size={40} />
          </button>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <button className="truncate text-[15px] font-semibold text-ink-1 hover:underline" onClick={() => onProfile?.(item.authorId)}>
              {item.author.username}
            </button>
            <time dateTime={item.createdAt} className="shrink-0 text-[11px] tabular-nums text-ink-4">{fmtStamp(item.createdAt)}</time>
          </div>
        )}
        {editing ? (
          <div className="mt-1">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onEditDone(item.id, null);
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onEditDone(item.id, draft);
                }
              }}
              maxLength={2000}
              rows={Math.min(8, draft.split("\n").length + 1)}
              className="field h-auto resize-none py-2.5"
              aria-label="Editar mensagem"
            />
            <div className="mt-1.5 flex items-center gap-2 text-[12px] text-ink-3">
              <button className="btn btn-primary h-7 px-2.5 text-[12px]" onClick={() => onEditDone(item.id, draft)}><Check size={14} /> Salvar</button>
              <button className="btn btn-ghost h-7 px-2.5 text-[12px]" onClick={() => onEditDone(item.id, null)}><X size={14} /> Cancelar</button>
              <span className="hidden sm:inline">Enter salva · Esc cancela</span>
            </div>
          </div>
        ) : (
          item.content && (
            <div className="text-[15px] leading-[1.45] text-ink-2">
              <Markdown text={item.content} me={me.username} />
              {item.editedAt && <span className="ml-1 text-[11px] text-ink-4">(editada)</span>}
            </div>
          )
        )}
        <Attachments items={item.attachments} />
        <Reactions list={item.reactions ?? []} onToggle={onReact ? (e, on) => onReact(item, e, on) : undefined} />
        {item.failed && (
          <button className="mt-1 text-[12px] font-medium text-danger hover:underline" onClick={() => onRetry?.(item)}>
            Não enviada. Toque para tentar de novo.
          </button>
        )}
      </div>
      {toolbar}
    </div>
  );
});

export function MessageList({
  resetKey,
  items,
  me,
  intro,
  hasOlder,
  fetchingOlder,
  loadOlder,
  canDeleteAny = false,
  onEdit,
  onDelete,
  onReact,
  onRetry,
  onProfile,
  editLastSignal,
}: {
  resetKey: string;
  items: ChatItem[];
  me: { id: string; username: string };
  intro: ReactNode;
  hasOlder: boolean;
  fetchingOlder: boolean;
  loadOlder: () => void;
  canDeleteAny?: boolean;
  onEdit?: (item: ChatItem, content: string) => void;
  onDelete?: (item: ChatItem) => void;
  onReact?: (item: ChatItem, emoji: string, on: boolean) => void;
  onRetry?: (item: ChatItem) => void;
  onProfile?: (userId: string) => void;
  editLastSignal?: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const mountedAt = useRef(Date.now());
  const lastId = useRef<string | undefined>(undefined);

  const count = items.length + 1;
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (i === 0 ? (hasOlder ? 56 : 180) : 52),
    getItemKey: (i) => (i === 0 ? "head" : items[i - 1].id),
    overscan: 10,
  });

  const toBottom = useCallback(() => {
    if (items.length) virtualizer.scrollToIndex(count - 1, { align: "end" });
    // Alturas reais chegam depois da 1ª medição: repete no próximo frame.
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [count, items.length, virtualizer]);

  // Troca de canal: começa no fim.
  useLayoutEffect(() => {
    mountedAt.current = Date.now();
    atBottom.current = true;
    lastId.current = undefined;
    setEditing(null);
    setSelected(null);
  }, [resetKey]);

  // Mensagem nova no fim: acompanha se o usuário já estava no fim (ou se é dele).
  useLayoutEffect(() => {
    const last = items[items.length - 1];
    if (!last) return;
    const appended = last.id !== lastId.current;
    const first = lastId.current === undefined;
    lastId.current = last.id;
    if (first || (appended && (atBottom.current || last.authorId === me.id))) toBottom();
  }, [items, me.id, toBottom]);

  useEffect(() => {
    if (!editLastSignal) return;
    const mine = [...items].reverse().find((m) => m.authorId === me.id && !m.pending);
    if (mine) setEditing(mine.id);
  }, [editLastSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottom.current = bottom;
    setShowJump(!bottom);
    if (el.scrollTop < 600 && hasOlder && !fetchingOlder) loadOlder();
  };

  const handleEditDone = useCallback(
    (id: string, content: string | null) => {
      setEditing(null);
      const item = items.find((m) => m.id === id);
      if (item && content !== null && content.trim() && content !== item.content) onEdit?.(item, content.trim());
    },
    [items, onEdit],
  );

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto overflow-x-hidden overscroll-contain [overflow-anchor:none]" role="log" aria-live="polite" aria-label="Mensagens">
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((v) => {
            if (v.index === 0) {
              return (
                <div key={v.key} ref={virtualizer.measureElement} data-index={0} className="absolute left-0 top-0 w-full" style={{ transform: `translateY(${v.start}px)` }}>
                  {hasOlder ? <div className="grid h-14 place-items-center text-ink-4">{fetchingOlder && <Spinner />}</div> : intro}
                </div>
              );
            }
            const item = items[v.index - 1];
            const prev = items[v.index - 2];
            const newDay = !prev || !sameDay(prev.createdAt, item.createdAt);
            const grouped = Boolean(prev) && !newDay && prev.authorId === item.authorId && new Date(item.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_MS;
            return (
              <div key={v.key} ref={virtualizer.measureElement} data-index={v.index} className="absolute left-0 top-0 w-full" style={{ transform: `translateY(${v.start}px)` }}>
                {newDay && (
                  <div className="flex items-center gap-3 px-4 pb-1 pt-5" role="separator">
                    <span className="h-px flex-1 bg-line" />
                    <span className="text-[11px] font-semibold text-ink-4">{fmtDay(item.createdAt)}</span>
                    <span className="h-px flex-1 bg-line" />
                  </div>
                )}
                <Row
                  item={item}
                  grouped={grouped}
                  me={me}
                  canDelete={item.authorId === me.id || canDeleteAny}
                  editable={Boolean(onEdit)}
                  isNew={new Date(item.createdAt).getTime() > mountedAt.current}
                  selected={selected === item.id}
                  editing={editing === item.id}
                  onSelect={setSelected}
                  onEditStart={setEditing}
                  onEditDone={handleEditDone}
                  onDelete={onDelete}
                  onReact={onReact}
                  onRetry={onRetry}
                  onProfile={onProfile}
                />
              </div>
            );
          })}
        </div>
        <div className="h-3" />
      </div>
      {showJump && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
          <button onClick={toBottom} className="anim-pop glass flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-medium text-ink-1 active:scale-95" data-state="open">
            <ArrowDown size={15} /> Ir para o fim
          </button>
        </div>
      )}
    </div>
  );
}
