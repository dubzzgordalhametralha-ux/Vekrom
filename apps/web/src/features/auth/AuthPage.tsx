import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, Headphones, Link2, MessagesSquare } from "lucide-react";
import { api, ApiError, setAccessToken } from "../../lib/api";
import { useSession } from "../../lib/store";
import { Avatar, Logo, Spinner } from "../../components/ui";

const DEMO_PEOPLE = [
  { id: "11", username: "nina.gg" },
  { id: "27", username: "kaue_" },
  { id: "33", username: "bia" },
  { id: "48", username: "rafa.exe" },
];

/** Cena do produto: um canal de voz ao vivo + mensagens, em vidro. Puramente decorativa. */
function ProductScene() {
  return (
    <div aria-hidden className="relative mx-auto mt-10 hidden w-full max-w-[460px] select-none lg:block">
      <div className="glass rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-ink-1">
            <Headphones size={15} className="text-volt" /> Squad ranqueada
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-live/15 px-2 py-0.5 text-[11px] font-semibold text-live">
            <span className="h-1.5 w-1.5 rounded-full bg-live" /> AO VIVO
          </span>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-3">
          {DEMO_PEOPLE.map((p, i) => (
            <div key={p.id} className="flex flex-col items-center gap-2 rounded-xl bg-white/[0.03] py-3 ring-1 ring-inset ring-white/[0.06]">
              <Avatar user={{ ...p, avatarUrl: null }} size={40} speaking={i === 1} />
              <span className="text-[11px] text-ink-3">{p.username}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="glass absolute -bottom-12 -right-6 w-[260px] rounded-xl p-3">
        <div className="flex gap-2.5">
          <Avatar user={{ id: "27", username: "kaue_", avatarUrl: null }} size={28} />
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-ink-1">kaue_ <span className="font-normal text-ink-4">agora</span></p>
            <p className="text-[12px] text-ink-2">bora mais uma? tô no <span className="rounded-sm bg-volt/15 px-0.5 text-volt">#ranked</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage({ mode }: { mode: "login" | "register" }) {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next")?.startsWith("/") && !params.get("next")?.startsWith("//") ? params.get("next")! : "/channels/@me";
  const setUser = useSession((s) => s.setUser);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const isLogin = mode === "login";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = isLogin ? await api.login(email, password) : await api.register(username, email, password);
      setAccessToken(r.token);
      setUser(r.user);
      nav(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "network"));
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (name: string) => error?.details?.[name]?.[0];

  return (
    <div className="relative min-h-dvh overflow-hidden bg-bg-0">
      {/* Luz volt + grade fina: identidade sem poluir. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-volt/[0.09] blur-[120px]" />
        <div className="absolute -bottom-60 right-[-10%] h-[520px] w-[620px] rounded-full bg-[#3b5bff]/[0.08] blur-[140px]" />
        <div
          className="absolute inset-0 opacity-[0.35] [mask-image:radial-gradient(ellipse_at_30%_20%,black,transparent_70%)]"
          style={{ backgroundImage: "linear-gradient(rgb(255 255 255/0.05) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255/0.05) 1px, transparent 1px)", backgroundSize: "56px 56px" }}
        />
      </div>

      <div className="relative mx-auto grid min-h-dvh max-w-6xl items-center gap-10 px-4 pb-[calc(32px+var(--safe-bottom))] pt-[calc(24px+var(--safe-top))] sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <section className="lg:pb-16">
          <div className="flex items-center gap-2.5">
            <Logo size={34} />
            <span className="font-display text-[19px] font-bold tracking-tight">vekrom</span>
          </div>
          <h1 className="mt-8 font-display text-[34px] font-bold leading-[1.02] tracking-[-0.02em] text-ink-1 [text-wrap:balance] sm:text-[52px] lg:mt-14 lg:text-[60px]">
            Seu squad tem <span className="text-volt">casa</span>.
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-2 [text-wrap:pretty] sm:text-[16px]">
            Servidores, canais de voz e chat em tempo real para jogar junto, combinar a próxima e não perder nada.
          </p>
          <ul className="mt-7 hidden gap-5 text-[13px] text-ink-2 sm:flex">
            <li className="flex items-center gap-2"><Headphones size={16} className="text-volt" /> Voz com tela</li>
            <li className="flex items-center gap-2"><MessagesSquare size={16} className="text-volt" /> Chat ao vivo</li>
            <li className="flex items-center gap-2"><Link2 size={16} className="text-volt" /> Convite por link</li>
          </ul>
          <ProductScene />
        </section>

        <section className="w-full lg:justify-self-end">
          <form onSubmit={submit} className="glass mx-auto w-full max-w-[420px] rounded-2xl p-6 sm:p-8" noValidate>
            <h2 className="text-[22px] font-semibold tracking-tight">{isLogin ? "Bom te ver de novo" : "Crie sua conta"}</h2>
            <p className="mt-1 text-[13px] text-ink-3">{isLogin ? "Entre para voltar ao seu squad." : "Leva 20 segundos. Sem cartão, sem nada."}</p>

            {error && !error.details && (
              <div role="alert" className="mt-5 rounded-lg bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger ring-1 ring-inset ring-danger/25">
                {error.message}
              </div>
            )}

            <div className="mt-6 space-y-4">
              {!isLogin && (
                <div>
                  <label htmlFor="username" className="label">Nome de usuário</label>
                  <input id="username" className="field" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required minLength={2} maxLength={32} placeholder="seu.nick" aria-invalid={Boolean(fieldError("username"))} />
                  <p className={`mt-1.5 text-[12px] ${fieldError("username") ? "text-danger" : "text-ink-4"}`}>{fieldError("username") ?? "Letras, números, _ ou ponto. É assim que te acham."}</p>
                </div>
              )}
              <div>
                <label htmlFor="email" className="label">E-mail</label>
                <input id="email" type="email" inputMode="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" required placeholder="voce@email.com" />
                {fieldError("email") && <p className="mt-1.5 text-[12px] text-danger">E-mail inválido.</p>}
              </div>
              <div>
                <label htmlFor="password" className="label">Senha</label>
                <div className="relative">
                  <input id="password" type={show ? "text" : "password"} className="field pr-11" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={isLogin ? "current-password" : "new-password"} required minLength={isLogin ? 1 : 8} placeholder={isLogin ? "Sua senha" : "8 caracteres ou mais"} />
                  <button type="button" onClick={() => setShow((v) => !v)} className="icon-btn absolute right-1 top-1" aria-label={show ? "Esconder senha" : "Mostrar senha"}>
                    {show ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
                {fieldError("password") && <p className="mt-1.5 text-[12px] text-danger">A senha precisa de 8 caracteres ou mais.</p>}
              </div>
            </div>

            <button type="submit" className="btn btn-primary mt-7 h-11 w-full" disabled={busy || !email || !password || (!isLogin && username.length < 2)}>
              {busy ? <Spinner /> : <>{isLogin ? "Entrar" : "Criar conta"} <ArrowRight size={16} /></>}
            </button>

            <p className="mt-6 text-center text-[13px] text-ink-3">
              {isLogin ? "Ainda não tem conta? " : "Já tem conta? "}
              <Link to={`${isLogin ? "/register" : "/login"}${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-volt underline-offset-4 hover:underline">
                {isLogin ? "Criar agora" : "Entrar"}
              </Link>
            </p>
          </form>
        </section>
      </div>
    </div>
  );
}
