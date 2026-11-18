import { useState, type FormEvent } from "react";
import { APP_VERSION } from "@agendario/shared";
import { normalizeServer, setServer } from "../lib/platform";

/** Primera pantalla de la app: ¿dónde está tu Agendario? */
export function ServerSetup({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const base = normalizeServer(url);
    if (!base) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(10000) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error("not-agendario");
      setServer(base);
      onDone();
    } catch (err) {
      setError(
        (err as Error).message === "not-agendario"
          ? "Esa dirección responde, pero no es un servidor de Agendario."
          : "No se ha podido conectar. Comprueba la dirección y que el servidor esté en marcha (y, si estás fuera de casa, que sea accesible desde Internet).",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="m3 flex min-h-dvh flex-col px-6 pb-[calc(24px+var(--sab))] pt-[calc(4rem+var(--sat))]">
      <img src="/favicon.svg" alt="" className="h-20 w-20" />
      <h1 className="mt-8 text-[32px] font-normal leading-10">Conecta con tu Agendario</h1>
      <p className="mt-3 text-base text-slate-600">Escribe la dirección de tu servidor de Agendario: la misma que usas en el navegador.</p>
      <form onSubmit={submit} className="mt-8 flex flex-1 flex-col">
        <label className="m3-field">
          <span>Dirección del servidor</span>
          <input
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="agendario.midominio.es"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus
          />
        </label>
        <p className="mt-2 px-4 text-xs text-slate-500">Por ejemplo https://agendario.midominio.es o http://192.168.1.50:3002 (solo en casa).</p>
        {error && <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
        <div className="flex-1" />
        <button className="m3-filled-btn w-full" disabled={!url.trim() || busy}>{busy ? "Conectando…" : "Continuar"}</button>
        <p className="mt-4 text-center text-xs text-slate-400">Agendario {APP_VERSION}</p>
      </form>
    </div>
  );
}
