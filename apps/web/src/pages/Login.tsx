import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { User } from "@agendario/shared";
import { APP_VERSION } from "@agendario/shared";
import { BetaBadge } from "../components/BetaBadge";
import { api } from "../lib/api";
import { getServer, isApp, setServer, setToken } from "../lib/platform";

export function LoginPage() {
  const qc = useQueryClient();
  const { data: status } = useQuery({
    queryKey: ["auth-status"],
    queryFn: () => api.get<{ canRegister: boolean; firstUser: boolean }>("/auth/status"),
  });
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const registering = mode === "register" || status?.firstUser;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const user = registering
        ? await api.post<User & { token?: string }>("/auth/register", form)
        : await api.post<User & { token?: string }>("/auth/login", { email: form.email, password: form.password });
      if (user.token) setToken(user.token); // app de Android
      qc.setQueryData(["me"], user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <div className={`flex min-h-dvh items-center justify-center p-4 ${isApp ? "m3 app-safe-top" : ""}`}>
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
        <div className="flex flex-col items-center gap-2 pb-2">
          <img src="/favicon.svg" alt="" className="h-14 w-14" />
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">Agendario</h1>
            <BetaBadge />
          </div>
          {status?.firstUser && (
            <p className="text-center text-sm text-slate-500">Primer arranque: crea la cuenta de administrador.</p>
          )}
        </div>
        {registering && (
          <div>
            <label className="label">Nombre</label>
            <input className="input" value={form.name} onChange={set("name")} required autoComplete="name" />
          </div>
        )}
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={form.email} onChange={set("email")} required autoComplete="email" />
        </div>
        <div>
          <label className="label">Contraseña</label>
          <input
            className="input"
            type="password"
            value={form.password}
            onChange={set("password")}
            required
            minLength={registering ? 10 : 1}
            autoComplete={registering ? "new-password" : "current-password"}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {registering ? "Crear cuenta" : "Entrar"}
        </button>
        {status?.canRegister && !status.firstUser && (
          <button type="button" className="btn-ghost w-full" onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "Crear una cuenta nueva" : "Ya tengo cuenta"}
          </button>
        )}
        {isApp && (
          <p className="text-center text-xs text-slate-500">
            Servidor: {getServer().replace(/^https?:\/\//, "")} ·{" "}
            <button type="button" className="text-indigo-700 underline" onClick={() => { setServer(null); window.location.reload(); }}>Cambiar</button>
          </p>
        )}
        <p className="pt-2 text-center text-[11px] text-slate-400">v{APP_VERSION}</p>
      </form>
    </div>
  );
}
