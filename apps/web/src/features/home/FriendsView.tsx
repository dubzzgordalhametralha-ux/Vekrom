import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Check, MessageSquare, UserPlus, Users, X } from "lucide-react";
import { api, type Friend } from "../../lib/api";
import { useFriends, usePresence } from "../../lib/queries";
import { toast, toastError, useLive } from "../../lib/store";
import { Avatar, Empty, Spinner, Tip, presenceLabel } from "../../components/ui";
import { ChatHeader } from "../chat/ChannelView";

type Tab = "online" | "all" | "pending" | "add";

function FriendRow({ f, onChange, onAccepted }: { f: Friend; onChange: () => void | Promise<unknown>; onAccepted?: () => void }) {
  const status = usePresence(f.user.id, f.user.status);
  const act = (p: Promise<unknown>, ok?: string) => p.then(() => (ok && toast(ok, "success"), onChange())).catch(toastError);
  return (
    <div className="group flex items-center gap-3 rounded-lg border-t border-line px-2 py-2.5 transition-colors first:border-t-0 hover:bg-white/[0.03]">
      <Avatar user={f.user} size={38} status={f.status === "accepted" ? status : undefined} ring="ring-bg-2" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold">{f.user.username}</p>
        <p className="truncate text-[12px] text-ink-3">
          {f.status === "pending" ? (f.direction === "incoming" ? "Quer ser seu amigo" : "Pedido enviado") : f.user.bio || presenceLabel(status)}
        </p>
      </div>
      {f.status === "accepted" ? (
        <Tip label="Mensagem">
          <Link to={`/channels/@me/${f.user.id}`} className="icon-btn bg-white/[0.04]" aria-label={`Mensagem para ${f.user.username}`}>
            <MessageSquare size={17} />
          </Link>
        </Tip>
      ) : f.direction === "incoming" ? (
        <Tip label="Aceitar">
          <button className="icon-btn bg-white/[0.04] hover:!bg-online/15 hover:!text-online" onClick={() => { void api.acceptFriend(f.id).then(async () => { toast("Agora vocês são amigos.", "success"); await onChange(); onAccepted?.(); }).catch(toastError); }} aria-label="Aceitar pedido">
            <Check size={17} />
          </button>
        </Tip>
      ) : null}
      <Tip label={f.status === "accepted" ? "Desfazer amizade" : f.direction === "incoming" ? "Recusar" : "Cancelar pedido"}>
        <button className="icon-btn bg-white/[0.04] hover:!bg-danger/15 hover:!text-danger" onClick={() => act(api.removeFriend(f.id))} aria-label="Remover">
          <X size={17} />
        </button>
      </Tip>
    </div>
  );
}

function AddFriend({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.addFriend(name.trim().replace(/^@/, "").replace(/#\d{4}$/, "")); // aceita o formato antigo nome#1234
      toast(r.accepted ? `Você e ${name} agora são amigos.` : `Pedido enviado para ${name}.`, "success");
      setName("");
      onDone();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="max-w-xl">
      <h2 className="text-[16px] font-semibold">Adicionar amigo</h2>
      <p className="mt-1 text-[13px] text-ink-3">Use o nome de usuário exato da pessoa.</p>
      <div className="mt-4 flex gap-2 rounded-xl bg-bg-0/60 p-1.5 ring-1 ring-inset ring-white/[0.08] focus-within:ring-volt/60">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="nome.de.usuario" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="min-w-0 flex-1 bg-transparent px-2.5 text-[15px] outline-none placeholder:text-ink-4" aria-label="Nome de usuário" />
        <button className="btn btn-primary h-9 px-3.5 text-[13px]" disabled={busy || name.trim().length < 2}>
          {busy ? <Spinner /> : "Enviar pedido"}
        </button>
      </div>
    </form>
  );
}

export function FriendsView({ onMenu }: { onMenu: () => void }) {
  const [tab, setTab] = useState<Tab>("online");
  const qc = useQueryClient();
  const { data, isPending } = useFriends();
  const refresh = () => qc.invalidateQueries({ queryKey: ["friends"] });
  const accepted = (data ?? []).filter((f) => f.status === "accepted");
  const pending = (data ?? []).filter((f) => f.status === "pending");
  const live = useLive((s) => s.presence);
  const online = accepted.filter((f) => (live[f.user.id] ?? f.user.status ?? "offline") !== "offline");
  const list = tab === "online" ? online : tab === "all" ? accepted : pending;

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: "online", label: "Online" },
    { id: "all", label: "Todos" },
    { id: "pending", label: "Pendentes", count: pending.filter((f) => f.direction === "incoming").length },
  ];

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <ChatHeader onMenu={onMenu}>
        <Users size={19} className="text-ink-4" />
        <h1 className="text-[15px] font-semibold">Amigos</h1>
        <div className="ml-2 hidden h-5 w-px bg-line sm:block" />
        <nav role="tablist" className="scroll-none flex items-center gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors ${tab === t.id ? "bg-white/[0.08] text-ink-1" : "text-ink-3 hover:bg-white/[0.04] hover:text-ink-1"}`}>
              {t.label}
              {Boolean(t.count) && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{t.count}</span>}
            </button>
          ))}
          <button role="tab" aria-selected={tab === "add"} onClick={() => setTab("add")} className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-semibold transition-colors ${tab === "add" ? "bg-volt/15 text-volt" : "bg-volt text-volt-ink"}`}>
            <UserPlus size={15} /> Adicionar
          </button>
        </nav>
      </ChatHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
        {tab === "add" ? (
          <AddFriend onDone={refresh} />
        ) : isPending ? (
          <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-12 rounded-lg" />)}</div>
        ) : list.length === 0 ? (
          <Empty
            icon={<Users size={28} />}
            title={tab === "pending" ? "Nenhum pedido pendente" : tab === "online" ? "Ninguém online agora" : "Sua lista de amigos está vazia"}
            action={tab !== "pending" && <button className="btn btn-primary" onClick={() => setTab("add")}><UserPlus size={16} /> Adicionar amigo</button>}
          >
            {tab === "online" ? "Quando seus amigos entrarem, eles aparecem aqui." : "Adicione pelo nome de usuário ou chame alguém que já divide servidor com você."}
          </Empty>
        ) : (
          <>
            <p className="section-label mb-2 px-2">{tab === "online" ? "Online" : tab === "all" ? "Todos os amigos" : "Pendentes"} · {list.length}</p>
            {list.map((f) => <FriendRow key={f.id} f={f} onChange={refresh} onAccepted={f.direction === "incoming" ? () => setTab("all") : undefined} />)}
          </>
        )}
      </div>
    </div>
  );
}
