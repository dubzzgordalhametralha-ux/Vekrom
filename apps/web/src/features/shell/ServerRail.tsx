import { Plus } from "lucide-react";
import { Link } from "react-router-dom";
import type { Server } from "../../lib/api";
import { useLive } from "../../lib/store";
import { Logo, ServerIcon, Skeleton, Tip } from "../../components/ui";

/** Pílula à esquerda: 8px não lido, 20px hover, 36px ativo. */
function Pill({ active, unread }: { active: boolean; unread: boolean }) {
  return (
    <span
      aria-hidden
      className={`absolute left-0 w-1 rounded-r-full bg-ink-1 transition-[height,opacity] duration-200 ease-out ${
        active ? "h-9 opacity-100" : unread ? "h-2 opacity-100 group-hover:h-5" : "h-2 opacity-0 group-hover:h-5 group-hover:opacity-100"
      }`}
    />
  );
}

export function ServerRail({
  servers,
  loading,
  activeId,
  onCreate,
  onNavigate,
}: {
  servers: Server[];
  loading: boolean;
  activeId: string | null;
  onCreate: () => void;
  onNavigate?: () => void;
}) {
  const unread = useLive((s) => s.unread);
  const unreadServers = new Set(Object.values(unread));
  const homeActive = activeId === null;

  return (
    <nav aria-label="Servidores" className="flex h-full w-[72px] shrink-0 flex-col items-center gap-2 bg-bg-0 pb-[calc(12px+var(--safe-bottom))] pt-[calc(12px+var(--safe-top))]">
      <div className="group relative flex w-full justify-center">
        <Pill active={homeActive} unread={unreadServers.has("@me")} />
        <Tip label="Mensagens diretas" side="right">
          <Link to="/channels/@me" onClick={onNavigate} aria-label="Mensagens diretas" aria-current={homeActive ? "page" : undefined} className="transition-transform duration-150 ease-out active:scale-95">
            <span className={`grid h-12 w-12 place-items-center transition-[border-radius,background-color] duration-200 ease-out ${homeActive ? "rounded-[14px] bg-volt/15" : "rounded-[18px] bg-bg-3 group-hover:rounded-[14px]"}`}>
              <Logo size={30} />
            </span>
          </Link>
        </Tip>
      </div>
      <div className="h-px w-8 bg-line" />
      <div className="scroll-none flex w-full flex-1 flex-col items-center gap-2 overflow-y-auto overscroll-contain">
        {loading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-12 shrink-0 rounded-[18px]" />)}
        {servers.map((s) => {
          const active = s.id === activeId;
          return (
            <div key={s.id} className="group relative flex w-full justify-center">
              <Pill active={active} unread={unreadServers.has(s.id)} />
              <Tip label={s.name} side="right">
                <Link to={`/channels/${s.id}`} onClick={onNavigate} aria-label={s.name} aria-current={active ? "page" : undefined} className="transition-transform duration-150 ease-out active:scale-95 [&:hover>span]:rounded-[14px]">
                  <ServerIcon server={s} active={active} />
                </Link>
              </Tip>
            </div>
          );
        })}
        <Tip label="Criar ou entrar em servidor" side="right">
          <button onClick={onCreate} aria-label="Criar ou entrar em servidor" className="group grid h-12 w-12 shrink-0 place-items-center rounded-[18px] bg-bg-3 text-volt transition-[border-radius,background-color,color,transform] duration-200 ease-out hover:rounded-[14px] hover:bg-volt hover:text-volt-ink active:scale-95">
            <Plus size={22} />
          </button>
        </Tip>
      </div>
    </nav>
  );
}
