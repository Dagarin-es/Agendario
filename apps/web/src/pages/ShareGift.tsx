import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { LinkPreview } from "@agendario/shared";
import { ContactPicker } from "../components/ContactPicker";
import { QuickIdeaForm } from "../components/Gifts";
import { api } from "../lib/api";

/** Primer enlace de un texto compartido («Mira esto https://…»). */
export function firstUrl(s: string | null | undefined) {
  return s?.match(/https?:\/\/[^\s<>"']+/i)?.[0] ?? null;
}

/** «Compartir» desde Android → Añadir idea de regalo: enlace ya puesto, eliges para quién y guardas. */
export function ShareGiftPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const url = params.get("url") || firstUrl(params.get("text")) || firstUrl(params.get("title")) || "";
  const sharedTitle = (params.get("title") || params.get("text") || "").replace(url, "").trim();
  const [contact, setContact] = useState<{ id: string; displayName: string } | null>(null);
  const [picking, setPicking] = useState(true);
  const { data: preview, isLoading } = useQuery({
    queryKey: ["link-preview", url],
    enabled: !!url,
    queryFn: () => api.get<LinkPreview>(`/link-preview?url=${encodeURIComponent(url)}`),
    staleTime: Infinity,
  });
  const title = preview?.title || sharedTitle;
  return (
    <div className="mx-auto max-w-lg space-y-3">
      <h1 className="text-xl font-semibold">🎁 Añadir idea de regalo</h1>
      <div className="card flex items-center gap-3">
        {preview?.image ? <img src={preview.image} alt="" className="h-16 w-16 shrink-0 rounded-xl border border-slate-200 object-cover" /> : <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-2xl" aria-hidden="true">🎁</span>}
        <div className="min-w-0">
          <p className="truncate font-medium">{isLoading ? "Leyendo la página…" : title || "Sin título"}</p>
          <p className="truncate text-xs text-slate-500">{url || "No había ningún enlace en lo compartido"}</p>
        </div>
      </div>
      {contact ? (
        <div className="card space-y-3">
          <p className="text-sm">Para <strong>{contact.displayName}</strong> · <button className="text-indigo-700 hover:underline" onClick={() => setPicking(true)}>cambiar</button></p>
          {!isLoading && (
            <QuickIdeaForm key={contact.id} contactId={contact.id} initial={{ title, url }} onCancel={() => nav("/gifts")} onDone={() => nav(`/contacts/${contact.id}`)} />
          )}
        </div>
      ) : (
        <button className="btn-primary w-full" onClick={() => setPicking(true)}>¿Para quién es?</button>
      )}
      {picking && <ContactPicker title="¿Para quién es la idea?" onClose={() => setPicking(false)} onPick={(c) => { setContact(c); setPicking(false); }} />}
    </div>
  );
}
