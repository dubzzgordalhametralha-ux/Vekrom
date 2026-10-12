import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Shield, Trash2 } from "lucide-react";
import { api, type Role, type Server } from "../../lib/api";
import { can, PERM, PERM_LABELS } from "../../lib/permissions";
import { useRoles } from "../../lib/queries";
import { toast, toastError, useSession } from "../../lib/store";
import { Modal, Spinner } from "../../components/ui";
import { roleColor } from "../members/MemberList";
import { ImagePicker } from "./ServerModals";

const SWATCHES = [0xc6f432, 0x3ddc84, 0x3bc9ff, 0x6b8cff, 0xa98bff, 0xff6bcb, 0xff4d5e, 0xff9f43, 0xf5b83d, 0x8a8fa0];

function Toggle({ on, onChange, label, hint, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-3 border-t border-line py-3 first:border-t-0 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium">{label}</span>
        <span className="block text-[12px] text-ink-3">{hint}</span>
      </span>
      <input type="checkbox" className="peer sr-only" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden className="relative h-6 w-10 shrink-0 rounded-full bg-bg-4 ring-1 ring-inset ring-white/10 transition-colors duration-150 peer-checked:bg-volt peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-volt after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform after:duration-200 after:ease-out peer-checked:after:translate-x-4 peer-checked:after:bg-volt-ink" />
    </label>
  );
}

function RolesTab({ server }: { server: Server }) {
  const qc = useQueryClient();
  const { data: roles = [], isPending } = useRoles(server.id);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Role | null>(null);
  const isOwner = server.ownerId === useSession.getState().user?.id;
  const role = roles.find((r) => r.id === selected) ?? roles.find((r) => r.name !== "@everyone") ?? roles[0];

  useEffect(() => setDraft(role ? { ...role } : null), [role?.id, role?.permissions, role?.name, role?.color]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => qc.invalidateQueries({ queryKey: ["roles", server.id] });

  const create = async () => {
    try {
      const r = await api.createRole(server.id, { name: "novo cargo", color: SWATCHES[roles.length % SWATCHES.length] });
      await refresh();
      setSelected(r.role.id);
    } catch (e) {
      toastError(e);
    }
  };
  const save = async () => {
    if (!draft) return;
    try {
      await api.updateRole(server.id, draft.id, { name: draft.name === "@everyone" ? undefined : draft.name, permissions: draft.permissions, color: draft.color });
      await refresh();
      void qc.invalidateQueries({ queryKey: ["servers"] });
      toast("Cargo salvo.", "success");
    } catch (e) {
      toastError(e);
    }
  };
  const remove = async () => {
    if (!draft || !confirm(`Excluir o cargo ${draft.name}?`)) return;
    try {
      await api.deleteRole(server.id, draft.id);
      setSelected(null);
      await refresh();
    } catch (e) {
      toastError(e);
    }
  };

  if (isPending) return <div className="skeleton h-48 rounded-lg" />;
  const dirty = draft && role && (draft.name !== role.name || draft.permissions !== role.permissions || draft.color !== role.color);
  const everyone = draft?.name === "@everyone";

  return (
    <div className="grid gap-5 sm:grid-cols-[180px_1fr]">
      <div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 sm:flex-col sm:overflow-visible">
          {[...roles].sort((a, b) => b.position - a.position).map((r) => (
            <button key={r.id} onClick={() => setSelected(r.id)} data-active={r.id === role?.id} className="row h-9 shrink-0 gap-2 text-[13px] sm:w-full">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: roleColor(r) ?? "rgb(var(--ink-4))" }} />
              <span className="truncate">{r.name === "@everyone" ? "Todo mundo" : r.name}</span>
            </button>
          ))}
        </div>
        <button className="btn btn-ghost mt-2 h-9 w-full text-[13px]" onClick={() => void create()}>
          <Plus size={15} /> Novo cargo
        </button>
      </div>
      {draft && (
        <div>
          {!everyone && (
            <div className="space-y-4">
              <div>
                <label htmlFor="role-name" className="label">Nome</label>
                <input id="role-name" className="field" value={draft.name} maxLength={50} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div>
                <span className="label">Cor</span>
                <div className="flex flex-wrap gap-2">
                  {SWATCHES.map((c) => (
                    <button key={c} onClick={() => setDraft({ ...draft, color: c })} aria-label={`Cor #${c.toString(16)}`} aria-pressed={draft.color === c} className={`h-8 w-8 rounded-full transition-transform duration-150 active:scale-90 ${draft.color === c ? "ring-2 ring-white ring-offset-2 ring-offset-bg-2" : ""}`} style={{ background: `#${c.toString(16).padStart(6, "0")}` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
          {everyone && <p className="mb-2 text-[13px] text-ink-3">Vale para todo membro do servidor.</p>}
          <p className="section-label mb-1 mt-5">Permissões</p>
          <div>
            {PERM_LABELS.map((p) => (
              <Toggle
                key={p.bit}
                label={p.label}
                hint={p.hint}
                on={(draft.permissions & p.bit) === p.bit}
                disabled={!isOwner && (p.bit === PERM.ADMINISTRATOR || !can(server.permissions, p.bit))}
                onChange={(v) => setDraft({ ...draft, permissions: v ? draft.permissions | p.bit : draft.permissions & ~p.bit })}
              />
            ))}
          </div>
          <p className="mt-3 text-[12px] text-ink-4">Para dar o cargo a alguém, abra o perfil da pessoa na lista de membros.</p>
          <div className="mt-5 flex gap-2">
            {!everyone && <button className="btn btn-danger" onClick={() => void remove()}><Trash2 size={15} /> Excluir</button>}
            <button className="btn btn-primary ml-auto" disabled={!dirty} onClick={() => void save()}>Salvar cargo</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ServerSettingsModal({ server, onClose }: { server: Server; onClose: () => void }) {
  const me = useSession((s) => s.user)!;
  const isOwner = server.ownerId === me.id;
  const tabs = [
    can(server.permissions, PERM.MANAGE_SERVER) && { id: "overview", label: "Visão geral" },
    can(server.permissions, PERM.MANAGE_ROLES) && { id: "roles", label: "Cargos" },
    isOwner && { id: "danger", label: "Excluir" },
  ].filter(Boolean) as Array<{ id: string; label: string }>;
  const [tab, setTab] = useState(tabs[0]?.id ?? "overview");
  const [name, setName] = useState(server.name);
  const [icon, setIcon] = useState(server.iconUrl);
  const [busy, setBusy] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const qc = useQueryClient();
  const nav = useNavigate();

  const saveOverview = async () => {
    setBusy(true);
    try {
      await api.updateServer(server.id, { name, iconUrl: icon });
      await qc.invalidateQueries({ queryKey: ["servers"] });
      toast("Servidor salvo.", "success");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const destroy = async () => {
    try {
      await api.deleteServer(server.id);
      await qc.invalidateQueries({ queryKey: ["servers"] });
      nav("/channels/@me");
      onClose();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Modal open wide onOpenChange={(o) => !o && onClose()} title="Configurações do servidor" description={server.name}>
      <div role="tablist" className="mb-5 flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`-mb-px border-b-2 px-3 pb-2.5 pt-1 text-[13px] font-semibold transition-colors ${tab === t.id ? "border-volt text-ink-1" : "border-transparent text-ink-3 hover:text-ink-1"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="pb-3">
        {tab === "overview" && (
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              <ImagePicker value={icon} onChange={setIcon} label="Ícone do servidor" />
              <div className="flex-1">
                <label htmlFor="s-name" className="label">Nome do servidor</label>
                <input id="s-name" className="field" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
              </div>
            </div>
            {icon && <button className="text-[12px] text-ink-3 hover:text-danger" onClick={() => setIcon(null)}>Remover ícone</button>}
            <div className="flex justify-end">
              <button className="btn btn-primary" disabled={busy || !name.trim() || (name === server.name && icon === server.iconUrl)} onClick={() => void saveOverview()}>
                {busy ? <Spinner /> : "Salvar alterações"}
              </button>
            </div>
          </div>
        )}
        {tab === "roles" && <RolesTab server={server} />}
        {tab === "danger" && (
          <div className="rounded-xl bg-danger/[0.06] p-4 ring-1 ring-inset ring-danger/25">
            <div className="flex items-start gap-3">
              <Shield size={20} className="mt-0.5 text-danger" />
              <div>
                <h3 className="text-[15px] font-semibold">Excluir {server.name}</h3>
                <p className="mt-1 text-[13px] text-ink-3">Apaga canais, mensagens e cargos para todo mundo. Não tem volta.</p>
              </div>
            </div>
            <label htmlFor="confirm-name" className="label mt-4">Digite o nome do servidor para confirmar</label>
            <input id="confirm-name" className="field" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={server.name} />
            <button className="btn btn-danger mt-3 w-full" disabled={confirmName !== server.name} onClick={() => void destroy()}>Excluir servidor</button>
          </div>
        )}
      </div>
    </Modal>
  );
}
