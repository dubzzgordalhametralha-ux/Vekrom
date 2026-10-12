import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Check, Copy, Hash, Link2, Plus, Volume2 } from "lucide-react";
import { api, type Channel, type Server } from "../../lib/api";
import { toast, toastError, useSession } from "../../lib/store";
import { Modal, ServerIcon, Spinner } from "../../components/ui";

/** Pega o código de "https://.../invite/AbC123" ou do próprio código. */
export function inviteCode(input: string) {
  const m = input.trim().match(/(?:invite\/)?([A-Za-z0-9]{6,16})\/?$/);
  return m?.[1] ?? null;
}

export function ImagePicker({ value, onChange, label, round = false }: { value: string | null; onChange: (url: string | null) => void; label: string; round?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange((await api.upload(file)).url);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" onClick={() => ref.current?.click()} aria-label={label} className={`group relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden bg-bg-3 text-ink-3 border border-dashed border-white/20 transition-colors hover:text-ink-1 ${round ? "rounded-full" : "rounded-[22px]"}`}>
      {value ? <img src={value} alt="" className="h-full w-full object-cover" /> : <Camera size={22} />}
      <span className="absolute inset-0 grid place-items-center bg-black/55 text-[11px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">{busy ? <Spinner /> : "Trocar"}</span>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => void pick(e.target.files?.[0])} />
    </button>
  );
}

export function CreateServerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const user = useSession((s) => s.user);
  const [mode, setMode] = useState<"create" | "join">("create");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    if (open) {
      setMode("create");
      setName(user ? `Servidor de ${user.username}` : "");
      setIcon(null);
      setLink("");
    }
  }, [open, user]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "create") {
        const server = await api.createServer(name.trim(), icon);
        await qc.invalidateQueries({ queryKey: ["servers"] });
        nav(`/channels/${server.id}`);
      } else {
        const code = inviteCode(link);
        if (!code) throw new Error("Cole um link de convite válido.");
        nav(`/invite/${code}`);
      }
      onClose();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={mode === "create" ? "Crie seu servidor" : "Entrar com convite"}
      description={mode === "create" ? "Um lugar para você e seu squad. Dá para mudar tudo depois." : "Cole o link que alguém te mandou."}
    >
      <form id="server-form" onSubmit={submit} className="space-y-5 pb-2">
        <div role="tablist" className="grid grid-cols-2 gap-1 rounded-lg bg-bg-0/60 p-1 ring-1 ring-inset ring-white/[0.06]">
          {(["create", "join"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`h-9 rounded-md text-[13px] font-semibold transition-colors ${mode === m ? "bg-bg-4 text-ink-1 shadow-inset" : "text-ink-3 hover:text-ink-1"}`}>
              {m === "create" ? "Criar" : "Tenho um convite"}
            </button>
          ))}
        </div>
        {mode === "create" ? (
          <div className="flex items-center gap-4">
            <ImagePicker value={icon} onChange={setIcon} label="Ícone do servidor" />
            <div className="min-w-0 flex-1">
              <label htmlFor="server-name" className="label">Nome do servidor</label>
              <input id="server-name" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoFocus />
            </div>
          </div>
        ) : (
          <div>
            <label htmlFor="invite-link" className="label">Link do convite</label>
            <input id="invite-link" className="field" value={link} onChange={(e) => setLink(e.target.value)} placeholder={`${location.origin}/invite/Ab12Cd34`} autoCapitalize="none" autoCorrect="off" autoFocus />
          </div>
        )}
        <button className="btn btn-primary h-11 w-full" disabled={busy || (mode === "create" ? !name.trim() : !link.trim())}>
          {busy ? <Spinner /> : mode === "create" ? <><Plus size={16} /> Criar servidor</> : <><Link2 size={16} /> Ver convite</>}
        </button>
      </form>
    </Modal>
  );
}

export function CreateChannelModal({ server, open, onClose }: { server: Server; open: boolean; onClose: () => void }) {
  const [type, setType] = useState<Channel["type"]>("text");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();
  useEffect(() => void (open && (setName(""), setType("text"))), [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const ch = await api.createChannel(server.id, name, type);
      await qc.invalidateQueries({ queryKey: ["channels", server.id] });
      if (ch.type !== "voice") nav(`/channels/${server.id}/${ch.id}`);
      onClose();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const options = [
    { id: "text" as const, icon: Hash, label: "Texto", hint: "Mensagens, imagens, clipes" },
    { id: "voice" as const, icon: Volume2, label: "Voz", hint: "Conversa, câmera e tela" },
  ];
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="Criar canal" description={`em ${server.name}`}>
      <form onSubmit={submit} className="space-y-5 pb-2">
        <div className="grid gap-2">
          {options.map((o) => (
            <button key={o.id} type="button" onClick={() => setType(o.id)} aria-pressed={type === o.id} className={`flex items-center gap-3 rounded-lg px-3.5 py-3 text-left ring-1 ring-inset transition-colors ${type === o.id ? "bg-volt/[0.08] ring-volt/50" : "bg-bg-3 ring-white/[0.06] hover:bg-bg-4"}`}>
              <o.icon size={20} className={type === o.id ? "text-volt" : "text-ink-3"} />
              <span className="flex-1">
                <span className="block text-[14px] font-semibold">{o.label}</span>
                <span className="block text-[12px] text-ink-3">{o.hint}</span>
              </span>
              <span className={`grid h-5 w-5 place-items-center rounded-full ring-2 ring-inset ${type === o.id ? "bg-volt text-volt-ink ring-volt" : "ring-white/20"}`}>{type === o.id && <Check size={12} strokeWidth={3} />}</span>
            </button>
          ))}
        </div>
        <div>
          <label htmlFor="channel-name" className="label">Nome do canal</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4">{type === "voice" ? <Volume2 size={16} /> : <Hash size={16} />}</span>
            <input id="channel-name" className="field pl-9" value={name} onChange={(e) => setName(type === "voice" ? e.target.value : e.target.value.toLowerCase().replace(/\s+/g, "-"))} placeholder={type === "voice" ? "Squad 1" : "novo-canal"} maxLength={100} required autoFocus />
          </div>
        </div>
        <button className="btn btn-primary h-11 w-full" disabled={busy || !name.trim()}>{busy ? <Spinner /> : "Criar canal"}</button>
      </form>
    </Modal>
  );
}

export function ChannelSettingsModal({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? "");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const nav = useNavigate();
  const done = () => qc.invalidateQueries({ queryKey: ["channels", channel.serverId] });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.updateChannel(channel.id, { name, topic: topic.trim() || null });
      await done();
      toast("Canal salvo.", "success");
      onClose();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!confirm(`Excluir #${channel.name}? As mensagens somem junto.`)) return;
    try {
      await api.deleteChannel(channel.id);
      await done();
      nav(`/channels/${channel.serverId}`);
      onClose();
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Configurar canal" description={channel.type === "voice" ? "Canal de voz" : "Canal de texto"}>
      <form onSubmit={save} className="space-y-4 pb-2">
        <div>
          <label htmlFor="ch-name" className="label">Nome</label>
          <input id="ch-name" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
        </div>
        {channel.type !== "voice" && (
          <div>
            <label htmlFor="ch-topic" className="label">Tópico</label>
            <textarea id="ch-topic" className="field h-auto resize-none py-2.5" rows={3} value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={1024} placeholder="Sobre o que é esse canal?" />
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button type="button" className="btn btn-danger" onClick={() => void remove()}>Excluir</button>
          <button className="btn btn-primary ml-auto" disabled={busy || !name.trim()}>{busy ? <Spinner /> : "Salvar"}</button>
        </div>
      </form>
    </Modal>
  );
}

export function InviteModal({ server, onClose }: { server: Server; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api.createInvite(server.id).then((i) => setUrl(`${location.origin}/invite/${i.code}`), toastError);
  }, [server.id]);
  const copy = async () => {
    if (!url) return;
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share({ title: server.name, text: `Entra no ${server.name} no Vekrom`, url });
      else await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* cancelou o compartilhamento */
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Convide para ${server.name}`} description="Qualquer pessoa com o link entra. Ele vale por 7 dias.">
      <div className="flex items-center gap-3 pb-1 pt-1">
        <ServerIcon server={server} size={44} />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-bg-0/70 p-1.5 pl-3 ring-1 ring-inset ring-white/[0.08]">
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink-2">{url ?? "gerando link…"}</span>
          <button className={`btn h-9 shrink-0 px-3 text-[13px] ${copied ? "btn-ghost" : "btn-primary"}`} onClick={() => void copy()} disabled={!url}>
            {copied ? <><Check size={15} /> Copiado</> : <><Copy size={15} /> Copiar</>}
          </button>
        </div>
      </div>
      <div className="h-3" />
    </Modal>
  );
}
