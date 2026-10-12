import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { onAuthEvents, refresh, setAccessToken } from "./lib/api";
import { useSession } from "./lib/store";
import { gateway } from "./lib/ws";
import { Logo, Spinner } from "./components/ui";

// Code splitting por rota: quem só faz login não baixa o app inteiro.
const AuthPage = lazy(() => import("./features/auth/AuthPage"));
const InvitePage = lazy(() => import("./features/auth/InvitePage"));
const Shell = lazy(() => import("./features/shell/Shell"));

function Splash() {
  return (
    <div className="grid h-dvh place-items-center bg-bg-0">
      <div className="flex flex-col items-center gap-4 text-ink-3">
        <Logo size={44} />
        <Spinner size={18} />
      </div>
    </div>
  );
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const phase = useSession((s) => s.phase);
  const loc = useLocation();
  if (phase === "loading") return <Splash />;
  if (phase === "anon") return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return children;
}

export default function App() {
  const phase = useSession((s) => s.phase);
  const qc = useQueryClient();

  useEffect(() => {
    onAuthEvents({
      lost: () => {
        setAccessToken(null);
        gateway.disconnect();
        qc.clear();
        useSession.getState().setUser(null);
      },
      token: () => undefined,
    });
    // Sessão vem do cookie httpOnly de refresh; o access token só existe em memória.
    void refresh().then((r) => useSession.getState().setUser(r?.user ?? null));
  }, [qc]);

  return (
    <Suspense fallback={<Splash />}>
      <Routes>
        <Route path="/login" element={phase === "authed" ? <Navigate to="/channels/@me" replace /> : phase === "loading" ? <Splash /> : <AuthPage mode="login" />} />
        <Route path="/register" element={phase === "authed" ? <Navigate to="/channels/@me" replace /> : phase === "loading" ? <Splash /> : <AuthPage mode="register" />} />
        <Route path="/invite/:code" element={<RequireAuth><InvitePage /></RequireAuth>} />
        <Route path="/channels/*" element={<RequireAuth><Shell /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/channels/@me" replace />} />
      </Routes>
    </Suspense>
  );
}
