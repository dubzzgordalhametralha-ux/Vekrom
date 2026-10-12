import * as Dialog from "@radix-ui/react-dialog";
import * as DM from "@radix-ui/react-dropdown-menu";
import * as TT from "@radix-ui/react-tooltip";
import { forwardRef, type ReactNode } from "react";
import { X, CheckCircle2, AlertCircle, Info } from "lucide-react";
import type { Presence } from "../lib/api";
import { hueOf, initials } from "../lib/format";
import { useToasts } from "../lib/store";

// ---------------------------------------------------------------- avatar
const PRESENCE: Record<Presence, { color: string; label: string }> = {
  online: { color: "bg-online", label: "Disponível" },
  idle: { color: "bg-warn", label: "Ausente" },
  dnd: { color: "bg-danger", label: "Não perturbe" },
  offline: { color: "bg-ink-4", label: "Offline" },
};
export const presenceLabel = (p: Presence) => PRESENCE[p].label;

export function PresenceDot({ status, className = "", ring = "ring-bg-1", size = 10 }: { status: Presence; className?: string; ring?: string; size?: number }) {
  return (
    <span
      role="img"
      aria-label={PRESENCE[status].label}
      style={{ width: size, height: size }}
      className={`block rounded-full ring-[3px] ${ring} ${PRESENCE[status].color} ${className}`}
    />
  );
}

export function Avatar({
  user,
  size = 36,
  status,
  ring = "ring-bg-1",
  speaking = false,
}: {
  user: { id: string; username: string; avatarUrl?: string | null };
  size?: number;
  status?: Presence;
  ring?: string;
  speaking?: boolean;
}) {
  const hue = hueOf(user.id);
  const dot = Math.max(10, Math.round(size * 0.3));
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <span
        className={`grid h-full w-full place-items-center overflow-hidden rounded-full font-semibold text-white/90 ${speaking ? "speaking" : ""}`}
        style={{
          fontSize: Math.max(10, size * 0.36),
          background: user.avatarUrl ? undefined : `linear-gradient(140deg, hsl(${hue} 55% 42%), hsl(${(hue + 40) % 360} 60% 26%))`,
        }}
      >
        {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" loading="lazy" draggable={false} /> : initials(user.username)}
      </span>
      {status && <PresenceDot status={status} ring={ring} size={dot} className="absolute -bottom-0.5 -right-0.5" />}
    </span>
  );
}

export function ServerIcon({ server, size = 48, active = false }: { server: { id: string; name: string; iconUrl: string | null }; size?: number; active?: boolean }) {
  const hue = hueOf(server.id);
  return (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden font-display text-[13px] font-bold tracking-tight text-white transition-[border-radius] duration-200 ease-out ${active ? "rounded-[14px]" : "rounded-[18px]"}`}
      style={{
        width: size,
        height: size,
        background: server.iconUrl ? undefined : `radial-gradient(120% 120% at 0% 0%, hsl(${hue} 60% 46%), hsl(${(hue + 50) % 360} 55% 20%))`,
      }}
    >
      {server.iconUrl ? <img src={server.iconUrl} alt="" className="h-full w-full object-cover" draggable={false} /> : initials(server.name)}
    </span>
  );
}

// ---------------------------------------------------------------- modal (vira sheet no celular)
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-overlay fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content
          className={`anim-modal fixed z-50 flex max-h-[min(88dvh,760px)] flex-col overflow-hidden bg-bg-2 shadow-pop outline-none
            inset-x-0 bottom-0 rounded-t-2xl pb-[var(--safe-bottom)]
            sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100vw-32px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:pb-0
            ${wide ? "sm:max-w-[720px]" : "sm:max-w-[460px]"}`}
        >
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/15 sm:hidden" aria-hidden />
          <div className="relative z-10 flex items-start justify-between gap-4 px-5 pb-1 pt-4 sm:px-6 sm:pt-5">
            <div className="min-w-0">
              <Dialog.Title className="text-[17px] font-semibold tracking-tight text-ink-1">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-[13px] text-ink-3">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{typeof title === "string" ? title : "Janela"}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="icon-btn -mr-2 -mt-1" aria-label="Fechar">
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-3 sm:px-6">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line bg-bg-1/60 px-5 py-3 sm:px-6">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------- menu
export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;
export function MenuContent({ children, align = "start", side }: { children: ReactNode; align?: "start" | "end" | "center"; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <DM.Portal>
      <DM.Content align={align} side={side} sideOffset={6} collisionPadding={12} className="anim-pop glass z-50 min-w-[200px] rounded-lg p-1.5 text-[13px]">
        {children}
      </DM.Content>
    </DM.Portal>
  );
}
export const MenuItem = forwardRef<HTMLDivElement, { children: ReactNode; onSelect?: () => void; danger?: boolean; icon?: ReactNode; disabled?: boolean }>(
  ({ children, onSelect, danger, icon, disabled }, ref) => (
    <DM.Item
      ref={ref}
      disabled={disabled}
      onSelect={onSelect}
      className={`flex h-9 cursor-default items-center gap-2.5 rounded px-2.5 outline-none transition-colors duration-100 data-[disabled]:opacity-40 ${
        danger ? "text-danger data-[highlighted]:bg-danger data-[highlighted]:text-white" : "text-ink-2 data-[highlighted]:bg-white/[0.08] data-[highlighted]:text-ink-1"
      }`}
    >
      {icon}
      <span className="flex-1">{children}</span>
    </DM.Item>
  ),
);
export const MenuSep = () => <DM.Separator className="my-1 h-px bg-line" />;

// ---------------------------------------------------------------- tooltip (atraso só no primeiro)
export const TipProvider = ({ children }: { children: ReactNode }) => (
  <TT.Provider delayDuration={350} skipDelayDuration={400}>
    {children}
  </TT.Provider>
);
export function Tip({ label, children, side = "top" }: { label: ReactNode; children: ReactNode; side?: "top" | "right" | "bottom" | "left" }) {
  return (
    <TT.Root>
      <TT.Trigger asChild>{children}</TT.Trigger>
      <TT.Portal>
        <TT.Content side={side} sideOffset={8} className="anim-pop z-[60] rounded-md bg-bg-0 px-2.5 py-1.5 text-[12px] font-medium text-ink-1 shadow-pop">
          {label}
        </TT.Content>
      </TT.Portal>
    </TT.Root>
  );
}

// ---------------------------------------------------------------- estados
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} aria-hidden />;
}

export function MessageSkeleton() {
  return (
    <div className="space-y-6 px-4 py-6" aria-label="Carregando mensagens">
      {[0.62, 0.4, 0.8, 0.5, 0.7].map((w, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-3 w-28" />
            <div className="skeleton h-3 rounded" style={{ width: `${w * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center px-6 py-16 text-center">
      <div className="relative mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-bg-3 text-volt ring-1 ring-inset ring-white/[0.08]">
        <div className="absolute inset-0 -z-10 rounded-2xl bg-volt/20 blur-2xl" aria-hidden />
        {icon}
      </div>
      <h3 className="font-display text-[17px] font-semibold tracking-tight text-ink-1 [text-wrap:balance]">{title}</h3>
      {children && <p className="mt-2 text-[13px] leading-relaxed text-ink-3 [text-wrap:pretty]">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="inline-block animate-spin rounded-full border-2 border-current border-r-transparent" style={{ width: size, height: size, animationDuration: "600ms" }} aria-hidden />;
}

// ---------------------------------------------------------------- toasts
export function Toaster() {
  const items = useToasts((s) => s.items);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(16px+var(--safe-bottom))] z-[70] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:left-auto sm:right-6 sm:items-end"
    >
      {items.map((t) => (
        <div key={t.id} className="anim-pop glass pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-[13px] text-ink-1" data-state="open">
          {t.tone === "error" ? <AlertCircle size={16} className="text-danger" /> : t.tone === "success" ? <CheckCircle2 size={16} className="text-volt" /> : <Info size={16} className="text-ink-3" />}
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="18" fill="rgb(var(--bg-3))" />
      <path d="M15 17h9.5L32 38.5 39.5 17H49L36.5 47h-9z" fill="rgb(var(--volt))" />
    </svg>
  );
}
