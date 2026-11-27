import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Chevron } from "./Chevron";
import { useState, type ReactNode } from "react";
import type { CalendarFeed } from "@agendario/shared";
import { api } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { apiUrl, getServer, isApp } from "../lib/platform";
import { useConfirm } from "./Dialogs";

type SectionT = (p: { title: string; icon: ReactNode; desc?: string; children: ReactNode }) => ReactNode;

/** Calendario .ics: enlace privado para suscribirse desde otro calendario y descarga del fichero. */
export function CalendarFeedSettings({ Section }: { Section: SectionT }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [copied, setCopied] = useState(false);
  const [help, setHelp] = useState(false);
  const { data: feed } = useQuery({ queryKey: ["calendar-feed"], queryFn: () => api.get<CalendarFeed>("/calendar/feed") });
  const done = (f: CalendarFeed) => qc.setQueryData(["calendar-feed"], f);
  const opts = useMutation({ mutationFn: (o: { events: boolean; personal: boolean }) => api.put<CalendarFeed>("/calendar/feed", o), onSuccess: done });
  const token = useMutation({ mutationFn: () => api.post<CalendarFeed>("/calendar/feed/token"), onSuccess: done });
  const revoke = useMutation({ mutationFn: () => api.del<CalendarFeed>("/calendar/feed/token"), onSuccess: done });
  if (!feed) return null;
  const base = isApp ? getServer() : window.location.origin;
  const url = feed.path ? `${base}${feed.path}` : "";
  const nothing = !feed.events && !feed.personal;
  const dl = apiUrl(`/calendar/export.ics?events=${feed.events}&personal=${feed.personal}`);

  return (
    <Section
      icon="📅"
      title="Calendario para suscribirse"
      desc="Tus fechas en Google Calendar, el calendario del iPhone, Fastmail u Outlook. Se actualiza solo: lo que cambies en Agendario llega a ese calendario en unas horas."
    >
      <div className="space-y-2 text-sm">
        <span className="font-medium">Qué incluye</span>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={feed.events} onChange={(e) => opts.mutate({ events: e.target.checked, personal: feed.personal })} />
          <span>🎉 <b>Eventos</b> · cumpleaños, aniversarios y demás fechas de tus contactos</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={feed.personal} onChange={(e) => opts.mutate({ events: feed.events, personal: e.target.checked })} />
          <span>📜 <b>Efemérides</b> · tus fechas personales (solo título y descripción: el comentario y la foto no salen de Agendario)</span>
        </label>
      </div>

      {url ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-2.5">
            <code className="min-w-0 flex-1 break-all text-xs text-slate-700">{url}</code>
            <button className="btn-primary px-3 py-1.5 text-sm" onClick={async () => { if (await copyText(url)) { setCopied(true); setTimeout(() => setCopied(false), 2000); } }}>
              {copied ? "✓ Copiado" : "Copiar"}
            </button>
          </div>
          <p className="text-xs text-amber-800">🔐 Es un enlace privado: quien lo tenga ve tus fechas. Si lo compartiste sin querer, cámbialo.</p>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-ghost border border-slate-200 text-sm"
              onClick={async () => (await confirm({ title: "¿Cambiar el enlace?", message: "El enlace actual dejará de funcionar y tendrás que suscribirte de nuevo con el nuevo.", confirmText: "Cambiar" })) && token.mutate()}
            >
              🔄 Cambiar el enlace
            </button>
            <button
              className="btn-ghost text-sm text-red-700"
              onClick={async () => (await confirm({ title: "¿Quitar el enlace?", message: "Los calendarios suscritos dejarán de recibir tus fechas.", confirmText: "Quitar", danger: true })) && revoke.mutate()}
            >
              Quitar el enlace
            </button>
          </div>
        </div>
      ) : (
        <button className="btn-primary" disabled={token.isPending || nothing} onClick={() => token.mutate()}>🔗 Crear enlace de suscripción</button>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <a className={`btn-ghost border border-slate-200 text-sm ${nothing ? "pointer-events-none opacity-50" : ""}`} href={dl} download>
          ⬇️ Descargar .ics
        </a>
        <span className="text-xs text-slate-500">Una copia de hoy para importarla en otro calendario (no se actualiza).</span>
      </div>

      <button className="inline-flex items-center gap-1 text-left text-sm text-indigo-700 hover:underline" onClick={() => setHelp((h) => !h)}><Chevron dir="right" open={help} className="h-4 w-4" /> Cómo suscribirse</button>
      {help && (
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600">
          <li><b>Google Calendar</b> (en el ordenador): Otros calendarios → <i>+</i> → <i>Desde URL</i> → pega el enlace.</li>
          <li><b>iPhone / iPad</b>: Ajustes → Calendario → Cuentas → Añadir cuenta → Otra → <i>Añadir calendario suscrito</i>.</li>
          <li><b>Mac</b>: Calendario → Archivo → <i>Nueva suscripción de calendario</i>.</li>
          <li><b>Fastmail</b>: Ajustes → Calendarios → <i>Suscribirse a un calendario</i>.</li>
          <li><b>Outlook</b>: Añadir calendario → <i>Suscribirse desde la web</i>.</li>
        </ul>
      )}
      {!base.startsWith("https://") && url && (
        <p className="text-xs text-slate-500">ℹ️ Google y Apple solo leen calendarios publicados por <b>https</b> y accesibles desde internet (p. ej. a través de Nginx Proxy Manager).</p>
      )}
    </Section>
  );
}
