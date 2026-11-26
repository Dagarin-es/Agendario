import { useState, type FormEvent } from "react";
import { APP_VERSION } from "@agendario/shared";
import { normalizeServer, setServer } from "../lib/platform";
import { SelfHostedNotice } from "../components/SelfHosted";

/**
 * Pantalla «Conecta con tu Agendario».
 * - Primera vez (sin servidor guardado): pide la dirección.
 * - Cambiar de servidor (`current` + `onCancel`): viene rellena con el servidor actual y con Cancelar,
 *   que vuelve sin tocar nada. Solo se cambia al pulsar Continuar y comprobar que el nuevo responde;
 *   `onChange` se encarga de cerrar la sesión del anterior.
 */
export function ServerSetup({
  onDone,
  current,
  onCancel,
  onChange,
}: {
  onDone: () => void;
  current?: string;
  onCancel?: () => void;
  onChange?: (base: string) => Promise<void>;
}) {
  const changing = !!onCancel;
  const [url, setUrl] = useState(current ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const base = normalizeServer(url);
    if (!base) return;
    // El mismo servidor: no hay nada que cambiar
    if (changing && current && base === normalizeServer(current)) return onCancel?.();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(10000) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error("not-agendario");
      if (onChange) await onChange(base);
      else setServer(base);
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
    <div className="m3 flex min-h-dvh flex-col px-6 pb-[calc(24px+var(--sab))] pt-[calc(3rem+var(--sat))]">
      <img src="/favicon.svg" alt="" className="h-16 w-16" />
      <h1 className="mt-6 text-[30px] font-normal leading-10">{changing ? "Cambiar de servidor" : "Conecta con tu Agendario"}</h1>
      {!changing && <div className="mt-5"><SelfHostedNotice /></div>}
      <p className="mt-5 text-base text-slate-600">
        {changing ? "Escribe la dirección del otro servidor de Agendario. Si cancelas, todo sigue como estaba." : "Escribe la dirección de tu servidor de Agendario: la misma que usas en el navegador."}
      </p>
      <form onSubmit={submit} className="mt-6 flex flex-1 flex-col">
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
            onFocus={(e) => changing && e.currentTarget.select()}
            autoFocus={!changing}
          />
        </label>
        <p className="mt-2 px-4 text-xs text-slate-500">Por ejemplo https://agendario.midominio.es o http://192.168.1.50:3002 (solo en casa).</p>
        {changing && <p className="mt-2 px-4 text-xs text-slate-500">Al cambiar se cierra la sesión en el servidor actual y tendrás que entrar en el nuevo.</p>}
        {error && <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
        <div className="min-h-6 flex-1" />
        <div className="flex gap-3">
          {changing && <button type="button" className="m3-tonal-btn flex-1" onClick={onCancel} disabled={busy}>Cancelar</button>}
          <button className="m3-filled-btn flex-1" disabled={!url.trim() || busy}>{busy ? "Conectando…" : "Continuar"}</button>
        </div>
        <p className="mt-4 text-center text-xs text-slate-400">Agendario {APP_VERSION}</p>
      </form>
    </div>
  );
}
