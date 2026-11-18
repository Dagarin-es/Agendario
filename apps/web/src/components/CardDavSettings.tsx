import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { User, UserPrefs } from "@agendario/shared";
import { api } from "../lib/api";
import { getServer, isApp } from "../lib/platform";
import { copyText } from "../lib/clipboard";
import { useUserPrefs } from "./QuickActions";
import { TagChip, tagTree, useTags } from "./Tags";

type SectionT = (p: { title: string; icon: string; desc?: string; children: ReactNode }) => ReactNode;

/** Servidor CardDAV: qué libretas ve el móvil y cómo configurarlo. */
export function CardDavSettings({ Section, me }: { Section: SectionT; me: User }) {
  const qc = useQueryClient();
  const { data: prefs } = useUserPrefs();
  const { data: tags } = useTags();
  const save = useMutation({
    mutationFn: (v: UserPrefs) => api.put("/prefs", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prefs"] }),
  });
  if (!prefs) return null;
  const cfg = prefs.carddav;
  const set = (patch: Partial<UserPrefs["carddav"]>) => save.mutate({ ...prefs, carddav: { ...cfg, ...patch } });
  const tree = tagTree(tags);
  const books = [
    ...(cfg.all ? [{ id: "all", name: "Agendario", count: "todos tus contactos" }] : []),
    ...tree.filter((n) => cfg.tagIds.includes(n.tag.id)).map((n) => ({ id: n.tag.id, name: `Agendario · ${n.path}`, count: `${n.tag.totalCount} ${n.tag.totalCount === 1 ? "contacto" : "contactos"}${n.childCount ? " (con sus subetiquetas)" : ""}` })),
  ];
  const url = `${isApp ? getServer() : window.location.origin}/dav/`;
  const https = url.startsWith("https:");
  return (
    <Section icon="📱" title="Contactos en el móvil (CardDAV)" desc="El móvil se conecta a Agendario y ve tus contactos en su app de Contactos, con fotos, en los dos sentidos.">
      <div className="space-y-2">
        <span className="label">Libretas que verá el móvil</span>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={cfg.all} onChange={(e) => set({ all: e.target.checked })} /> <strong>Agendario</strong> — todos mis contactos
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-500">Y una libreta por cada etiqueta marcada:</span>
          {tagTree(tags).map((n) => (
            <TagChip
              key={n.tag.id}
              tag={{ ...n.tag, name: n.path }}
              active={cfg.tagIds.includes(n.tag.id)}
              onClick={() => set({ tagIds: cfg.tagIds.includes(n.tag.id) ? cfg.tagIds.filter((x) => x !== n.tag.id) : [...cfg.tagIds, n.tag.id] })}
            />
          ))}
        </div>
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-900">Libretas que verá el móvil ({books.length})</p>
          {books.length === 0 ? (
            <p className="text-sm text-slate-500">Ninguna: marca «Agendario» o alguna etiqueta.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {books.map((b) => (
                <li key={b.id} className="flex items-center gap-2">
                  <span aria-hidden="true">📒</span>
                  <span className="font-medium text-slate-800">{b.name}</span>
                  <span className="text-xs text-slate-500">· {b.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-xs text-slate-500">
          Cada etiqueta incluye sus subetiquetas. En una libreta de etiqueta van los datos de esa etiqueta y los que no tienen etiqueta. Lo que crees en esa libreta desde el
          móvil llega con la etiqueta; lo que borres en el móvil va a la papelera.
        </p>
      </div>
      <div className="space-y-1.5 rounded-lg bg-slate-50 p-3 text-sm">
        <p><span className="text-slate-500">Servidor:</span> <code className="break-all">{url}</code> <button className="ml-1 text-xs text-indigo-700 hover:underline" onClick={() => copyText(url)}>Copiar</button></p>
        <p><span className="text-slate-500">Usuario:</span> {me.email} · <span className="text-slate-500">Contraseña:</span> la de Agendario</p>
        {!https && <p className="text-xs text-amber-800">⚠️ Estás entrando por http. Para el móvil (sobre todo el iPhone) usa la dirección https de Nginx Proxy Manager.</p>}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-slate-700">Cómo configurarlo</summary>
        <div className="mt-2 space-y-2 text-slate-600">
          <p><strong>Android</strong>: instala <strong>DAVx⁵</strong> (F-Droid o Play Store) → «+» → «Acceder con URL y nombre de usuario» → pega la dirección del servidor, tu email y tu contraseña → marca las libretas → listo. Aparecen en la app de Contactos.</p>
          <p><strong>iPhone</strong>: Ajustes → Contactos → Cuentas → Añadir cuenta → Otra → Añadir cuenta CardDAV → servidor (sin «https://» ni «/dav/», solo el dominio), usuario y contraseña.</p>
          <p><strong>Mac</strong>: Contactos → Ajustes → Cuentas → «+» → Otra cuenta de Contactos → CardDAV, con los mismos datos.</p>
        </div>
      </details>
    </Section>
  );
}
