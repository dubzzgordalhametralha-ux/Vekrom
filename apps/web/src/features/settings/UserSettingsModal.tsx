import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { api, setAccessToken } from "../../lib/api";
import { toast, toastError, useSession, useVoice } from "../../lib/store";
import { gateway } from "../../lib/ws";
import { hueOf } from "../../lib/format";
import { Avatar, Modal, Spinner } from "../../components/ui";
import { ImagePicker } from "../servers/ServerModals";

const BANNERS = ["#C6F432", "#3DDC84", "#3BC9FF", "#6B8CFF", "#A98BFF", "#FF6BCB", "#FF4D5E", "#FF9F43", "#232733"];

function ProfileTab() {
  const user = useSession((s) => s.user)!;
  const setUser = useSession((s) => s.setUser);
  const [username, setUsername] = useState(user.username);
  const [bio, setBio] = useState(user.bio ?? "");
  const [avatar, setAvatar] = useState(user.avatarUrl);
  const [banner, setBanner] = useState(user.bannerColor);
  const [busy, setBusy] = useState(false);
  const dirty = username !== user.username || bio !== (user.bio ?? "") || avatar !== user.avatarUrl || banner !== user.bannerColor;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      setUser(await api.updateMe({ username, bio: bio.trim() || null, avatarUrl: avatar, bannerColor: banner }));
      toast("Perfil salvo.", "success");
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const hue = hueOf(user.id);
  return (
    <form onSubmit={save} className="grid gap-6 pb-3 sm:grid-cols-[1fr_240px]">
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <ImagePicker value={avatar} onChange={setAvatar} label="Foto de perfil" round />
          {avatar && <button type="button" className="text-[12px] text-ink-3 hover:text-danger" onClick={() => setAvatar(null)}>Remover foto</button>}
        </div>
        <div>
          <label htmlFor="u-name" className="label">Nome de usuário</label>
          <input id="u-name" className="field" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" maxLength={32} />
        </div>
        <div>
          <label htmlFor="u-bio" className="label">Sobre mim</label>
          <textarea id="u-bio" className="field h-auto resize-none py-2.5" rows={3} maxLength={190} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Main support, joga à noite, aceita duo." />
          <p className="mt-1 text-right text-[11px] text-ink-4">{bio.length}/190</p>
        </div>
        <div>
          <span className="label">Cor do banner</span>
          <div className="flex flex-wrap gap-2">
            {BANNERS.map((c) => (
              <button key={c} type="button" onClick={() => setBanner(c)} aria-label={`Banner ${c}`} aria-pressed={banner === c} className={`h-8 w-8 rounded-full transition-transform duration-150 active:scale-90 ${banner === c ? "ring-2 ring-white ring-offset-2 ring-offset-bg-2" : ""}`} style={{ background: c }} />
            ))}
          </div>
        </div>
        <button className="btn btn-primary" disabled={!dirty || busy}>{busy ? <Spinner /> : "Salvar perfil"}</button>
      </div>
      <div aria-label="Prévia" className="hidden overflow-hidden rounded-xl bg-bg-1 ring-1 ring-inset ring-white/[0.07] sm:block">
        <div className="h-16" style={{ background: banner ? `linear-gradient(135deg, ${banner}, rgb(var(--bg-1)))` : `linear-gradient(135deg, hsl(${hue} 45% 32%), hsl(${(hue + 60) % 360} 50% 16%))` }} />
        <div className="px-4 pb-4">
          <div className="-mt-8 inline-block rounded-full ring-4 ring-bg-1"><Avatar user={{ id: user.id, username, avatarUrl: avatar }} size={60} /></div>
          <p className="mt-1 text-[16px] font-semibold">{username}</p>
          <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-3">{bio || "Sem bio ainda."}</p>
        </div>
      </div>
    </form>
  );
}

function AccountTab({ onClose }: { onClose: () => void }) {
  const user = useSession((s) => s.user)!;
  const qc = useQueryClient();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [del, setDel] = useState("");
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    useVoice.getState().leave();
    await api.logout().catch(() => undefined);
    setAccessToken(null);
    gateway.disconnect();
    qc.clear();
    useSession.getState().setUser(null);
    onClose();
  };
  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.changePassword(cur, next);
      toast("Senha trocada. As outras sessões foram encerradas.", "success");
      setCur("");
      setNext("");
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  const deleteAccount = async () => {
    if (!confirm("Excluir sua conta? Seus servidores e mensagens somem para sempre.")) return;
    try {
      await api.deleteAccount(del);
      await signOut();
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <div className="space-y-7 pb-3">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-bg-1 p-4 ring-1 ring-inset ring-white/[0.06]">
        <div className="min-w-0">
          <p className="section-label">E-mail</p>
          <p className="mt-1 truncate text-[14px]">{user.email}</p>
        </div>
        <button className="btn btn-ghost shrink-0" onClick={() => void signOut()}><LogOut size={16} /> Sair</button>
      </div>
      <form onSubmit={changePassword} className="space-y-3">
        <h3 className="text-[15px] font-semibold">Trocar senha</h3>
        <input className="field" type="password" placeholder="Senha atual" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" aria-label="Senha atual" />
        <input className="field" type="password" placeholder="Nova senha (8+ caracteres)" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} aria-label="Nova senha" />
        <button className="btn btn-primary" disabled={busy || !cur || next.length < 8}>{busy ? <Spinner /> : "Trocar senha"}</button>
      </form>
      <div className="rounded-xl bg-danger/[0.06] p-4 ring-1 ring-inset ring-danger/25">
        <h3 className="text-[15px] font-semibold">Excluir conta</h3>
        <p className="mt-1 text-[13px] text-ink-3">Apaga sua conta, seus servidores e suas mensagens. Não dá para desfazer.</p>
        <div className="mt-3 flex gap-2">
          <input className="field" type="password" placeholder="Sua senha" value={del} onChange={(e) => setDel(e.target.value)} aria-label="Senha para excluir conta" />
          <button className="btn btn-danger shrink-0" disabled={!del} onClick={() => void deleteAccount()}>Excluir</button>
        </div>
      </div>
    </div>
  );
}

export default function UserSettingsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"profile" | "account">("profile");
  return (
    <Modal open wide onOpenChange={(o) => !o && onClose()} title="Configurações">
      <div role="tablist" className="mb-5 flex gap-1 border-b border-line">
        {(
          [
            ["profile", "Perfil"],
            ["account", "Conta"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`-mb-px border-b-2 px-3 pb-2.5 pt-1 text-[13px] font-semibold transition-colors ${tab === id ? "border-volt text-ink-1" : "border-transparent text-ink-3 hover:text-ink-1"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "profile" ? <ProfileTab /> : <AccountTab onClose={onClose} />}
    </Modal>
  );
}
