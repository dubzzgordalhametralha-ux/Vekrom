import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Unlink } from "lucide-react";
import { api } from "../../lib/api";
import { toastError } from "../../lib/store";
import { Empty, Logo, ServerIcon, Skeleton, Spinner } from "../../components/ui";

export default function InvitePage() {
  const { code = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["invite", code], queryFn: () => api.invite(code) });

  const join = async () => {
    setBusy(true);
    try {
      const server = await api.joinInvite(code);
      await qc.invalidateQueries({ queryKey: ["servers"] });
      nav(`/channels/${server.id}`, { replace: true });
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  };

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-bg-0 px-4">
      <div aria-hidden className="absolute left-1/2 top-1/3 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-volt/[0.08] blur-[120px]" />
      <div className="glass relative w-full max-w-[400px] rounded-2xl p-8 text-center">
        <div className="mb-6 flex justify-center"><Logo size={30} /></div>
        {q.isPending ? (
          <div className="flex flex-col items-center gap-3">
            <Skeleton className="h-20 w-20 rounded-[22px]" />
            <Skeleton className="h-4 w-40" />
          </div>
        ) : q.isError ? (
          <Empty icon={<Unlink size={26} />} title="Convite inválido" action={<Link to="/channels/@me" className="btn btn-ghost">Voltar ao Vekrom</Link>}>
            Esse link expirou ou foi apagado. Peça um novo para quem te convidou.
          </Empty>
        ) : (
          <>
            <p className="text-[13px] text-ink-3">Você foi convidado para</p>
            <div className="mt-4 flex justify-center"><ServerIcon server={q.data.server} size={80} /></div>
            <h1 className="mt-4 font-display text-[22px] font-bold tracking-tight [text-wrap:balance]">{q.data.server.name}</h1>
            <p className="mt-2 flex items-center justify-center gap-1.5 text-[13px] text-ink-3">
              <Users size={14} /> {q.data.server.memberCount} {q.data.server.memberCount === 1 ? "membro" : "membros"}
            </p>
            <button className="btn btn-primary mt-7 h-11 w-full" onClick={join} disabled={busy}>
              {busy ? <Spinner /> : "Aceitar convite"}
            </button>
            <Link to="/channels/@me" className="mt-3 inline-block text-[13px] text-ink-3 hover:text-ink-1">Agora não</Link>
          </>
        )}
      </div>
    </div>
  );
}
