import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { AppPassword, User, UserPrefs } from "@agendario/shared";
import { Modal, useAlert, useConfirm } from "./Dialogs";
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
        <p><span className="text-slate-500">Usuario:</span> {me.email} · <span className="text-slate-500">Contraseña:</span> una contraseña de aplicación (abajo)</p>
        {!https && <p className="text-xs text-amber-800">⚠️ Estás entrando por http. Para el móvil (sobre todo el iPhone) usa la dirección https de Nginx Proxy Manager.</p>}
      </div>
      <AppPasswords />
      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-slate-700">Cómo configurarlo</summary>
        <div className="mt-2 space-y-2 text-slate-600">
          <p><strong>Android</strong>: instala <strong>DAVx⁵</strong> (F-Droid o Play Store) → «+» → «Acceder con URL y nombre de usuario» → pega la dirección del servidor, tu email y una contraseña de aplicación → marca las libretas → en «Método de grupos» elige <strong>«Los grupos son categorías de los contactos»</strong> → listo. Aparecen en la app de Contactos, con tus etiquetas como grupos.</p>
          <p><strong>iPhone</strong>: Ajustes → Contactos → Cuentas → Añadir cuenta → Otra → Añadir cuenta CardDAV → servidor (sin «https://» ni «/dav/», solo el dominio), usuario y contraseña.</p>
          <p><strong>Mac</strong>: Contactos → Ajustes → Cuentas → «+» → Otra cuenta de Contactos → CardDAV, con los mismos datos.</p>
        </div>
      </details>
    </Section>
  );
}

/**
 * Contraseñas de aplicación: una por dispositivo o programa (DAVx⁵ del móvil, Outlook del trabajo…).
 * Solo sirven para CardDAV, se ven una sola vez y se pueden revocar una a una sin cambiar la de la cuenta.
 */
function AppPasswords() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ name: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const { data: list } = useQuery({ queryKey: ["app-passwords"], queryFn: () => api.get<AppPassword[]>("/auth/app-passwords") });
  const create = useMutation({
    mutationFn: (n: string) => api.post<{ id: string; password: string }>("/auth/app-passwords", { name: n }),
    onSuccess: (r, n) => { setCreated({ name: n, password: r.password }); setName(""); qc.invalidateQueries({ queryKey: ["app-passwords"] }); },
    onError: (e) => showAlert("No se ha podido crear", (e as Error).message),
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.del(`/auth/app-passwords/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["app-passwords"] }) });
  const when = (d: string) => new Date(d).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="space-y-2.5 rounded-xl border border-slate-200 p-3">
      <div>
        <span className="label">🔑 Contraseñas de aplicación</span>
        <p className="text-xs text-slate-500">
          Crea una para cada dispositivo o programa (DAVx⁵, el Mac, Outlook…). Solo valen para sincronizar contactos y puedes quitarlas una a una sin tocar tu contraseña.
          {list && list.length === 0 && " Mientras no tengas ninguna, CardDAV acepta también la contraseña de tu cuenta; en cuanto crees la primera, solo las de aplicación."}
        </p>
      </div>
      {list && list.length > 0 && (
        <ul className="divide-y divide-slate-100 text-sm">
          {list.map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{p.name}</span> <code className="text-xs text-slate-400">{p.hint}-····</code>
                <span className="block text-xs text-slate-500">Creada el {when(p.createdAt)} · {p.lastUsedAt ? `último uso el ${when(p.lastUsedAt)}` : "sin usar todavía"}</span>
              </span>
              <button
                className="text-xs text-red-700 hover:underline"
                onClick={async () => (await confirm({ title: `¿Quitar «${p.name}»?`, message: "Ese dispositivo o programa dejará de sincronizar hasta que le pongas otra contraseña.", confirmText: "Quitar", danger: true })) && revoke.mutate(p.id)}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); if (name.trim()) create.mutate(name.trim()); }}>
        <input className="input flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Para qué es (p. ej. «DAVx⁵ del Fold»)" maxLength={60} />
        <button className="btn-primary" disabled={!name.trim() || create.isPending}>Crear</button>
      </form>
      {created && (
        <Modal title="Contraseña de aplicación creada" onClose={() => { setCreated(null); setCopied(false); }}>
          <div className="space-y-3 p-4">
            <p className="text-sm">Para <strong>{created.name}</strong>. Cópiala ahora: <strong>no se volverá a mostrar</strong>.</p>
            <div className="flex items-center gap-2 rounded-xl bg-slate-100 p-3">
              <code className="flex-1 select-all text-lg font-semibold tracking-wider">{created.password}</code>
              <button className="btn-primary px-3 py-1.5 text-sm" onClick={async () => { if (await copyText(created.password)) setCopied(true); }}>{copied ? "✓ Copiada" : "Copiar"}</button>
            </div>
            <p className="text-xs text-slate-500">Úsala como contraseña en DAVx⁵ (o en el programa que sea) junto con tu email. Los guiones forman parte de la contraseña.</p>
            <div className="flex justify-end"><button className="btn-primary" onClick={() => { setCreated(null); setCopied(false); }}>Hecho</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
