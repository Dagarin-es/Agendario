import { keepInView } from "../lib/keepInView";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  messagingAppLabels,
  messagingApps,
  type ContactDetail,
  type ContactPrefs,
  type LabeledValue,
  type MessagingApp,
  type UserPrefs,
} from "@agendario/shared";
import { api } from "../lib/api";
import { useInstalledFilter } from "../lib/installed";
import { isMobileLike, isWebLink, messageLink, telLink, emailLink } from "../lib/links";

/** Enlace para escribir a una dirección con la app de correo elegida en Ajustes. */
export function useEmailHref() {
  const { data } = useUserPrefs();
  return (to: string) => emailLink(data?.emailApp, to);
}

export function useUserPrefs() {
  return useQuery({ queryKey: ["prefs"], queryFn: () => api.get<UserPrefs>("/prefs"), staleTime: 5 * 60_000 });
}

const byId = (list: LabeledValue[], id: string | null) => (id ? list.find((x) => x.id === id) : undefined);

/** Qué teléfono, email y app se usan por defecto con este contacto. */
export function resolveDefaults(c: ContactDetail, prefs: ContactPrefs, user?: UserPrefs) {
  return {
    callPhone: byId(c.phones, prefs.callPhoneId) ?? c.phones[0],
    messagePhone: byId(c.phones, prefs.messagePhoneId) ?? c.phones.find(isMobileLike) ?? c.phones[0],
    email: byId(c.emails, prefs.emailId) ?? c.emails[0],
    app: prefs.messagingApp ?? user?.messagingApp ?? "whatsapp",
    appIsCustom: !!prefs.messagingApp,
  };
}

function Split({ href, label, icon, children, onMain, disabled }: { href: string; label: ReactNode; icon: string; children: ReactNode; onMain?: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  if (disabled) return null;
  return (
    <span className="relative inline-flex">
      <a
        href={href}
        {...(isWebLink(href) ? { target: "_blank", rel: "noreferrer" } : {})}
        onClick={onMain}
        className="inline-flex min-w-0 items-center gap-1.5 rounded-l-xl bg-indigo-700 py-2 pl-3 pr-2.5 text-sm font-medium text-white hover:bg-indigo-800"
      >
        <span aria-hidden="true">{icon}</span>
        <span className="truncate">{label}</span>
      </a>
      <button
        type="button"
        className="rounded-r-xl border-l border-indigo-500 bg-indigo-700 px-1.5 text-white hover:bg-indigo-800"
        onClick={() => setOpen(!open)}
        aria-label="Más opciones"
        aria-expanded={open}
      >
        <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor" aria-hidden="true"><path d="M5.2 7.2a.75.75 0 0 1 1.06 0L10 10.94l3.74-3.74a.75.75 0 1 1 1.06 1.06l-4.27 4.27a.75.75 0 0 1-1.06 0L5.2 8.26a.75.75 0 0 1 0-1.06Z" /></svg>
      </button>
      {open && <span className="fixed inset-0 z-10" onClick={() => setOpen(false)} />}
      {open && (
        <span ref={keepInView} className="absolute left-0 top-full z-20 mt-1 block w-72 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-left text-sm text-slate-700 shadow-lg" onClick={() => setOpen(false)}>
          {children}
        </span>
      )}
    </span>
  );
}

const menuTitle = "block px-4 pb-1 pt-2 text-[11px] font-semibold uppercase text-slate-400";

/** Fila del menú: el dato (pulsar = usarlo) y una estrella para dejarlo por defecto. */
function ItemRow({ href, item, isDefault, onDefault, onUse }: { href: string; item: LabeledValue; isDefault: boolean; onDefault: () => void; onUse?: () => void }) {
  return (
    <span className="flex items-center hover:bg-slate-50">
      <a href={href} {...(isWebLink(href) ? { target: "_blank", rel: "noreferrer" } : {})} onClick={onUse} className="min-w-0 flex-1 px-4 py-2">
        <span className="block truncate">{item.value}</span>
        {item.label && <span className="block text-xs text-slate-400">{item.label}</span>}
      </a>
      <button
        type="button"
        className={`px-3 py-2 text-lg ${isDefault ? "text-amber-500" : "text-slate-300 hover:text-amber-500"}`}
        title={isDefault ? "Es el que se usa por defecto" : "Usar siempre este con este contacto"}
        aria-label={isDefault ? "Por defecto" : "Usar por defecto"}
        onClick={(e) => {
          e.stopPropagation();
          onDefault();
        }}
      >
        {isDefault ? "★" : "☆"}
      </button>
    </span>
  );
}

/** Botones Llamar · Mensaje · Email con el dato y la app por defecto (cambiables por contacto). */
export function QuickActions({ c, onCall, align = "center" }: { c: ContactDetail; onCall?: (phone: string) => void; align?: "center" | "start" }) {
  const qc = useQueryClient();
  const { data: user } = useUserPrefs();
  const cc = user?.countryCode ?? "34";
  const d = resolveDefaults(c, c.prefs, user);
  const onlyInstalled = useInstalledFilter();
  const save = useMutation({
    mutationFn: (patch: Partial<ContactPrefs>) => api.put(`/contacts/${c.id}/prefs`, { ...c.prefs, ...patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contact", c.id] }),
  });
  if (!c.phones.length && !c.emails.length) return null;

  return (
    <div className={`flex flex-wrap gap-2 ${align === "start" ? "justify-start" : "justify-center"}`}>
      {d.callPhone && (
        <Split href={telLink(d.callPhone.value)} icon="📞" label="Llamar" onMain={() => onCall?.(d.callPhone!.value)}>
          <span className={menuTitle}>Llamar a…</span>
          {c.phones.map((p) => (
            <ItemRow key={p.id ?? p.value} href={telLink(p.value)} item={p} isDefault={p === d.callPhone} onDefault={() => save.mutate({ callPhoneId: p.id ?? null })} onUse={() => onCall?.(p.value)} />
          ))}
        </Split>
      )}
      {d.messagePhone && (
        <Split href={messageLink(d.app, d.messagePhone.value, cc)} icon="💬" label={messagingAppLabels[d.app]}>
          <span className={menuTitle}>Escribir por {messagingAppLabels[d.app]} a…</span>
          {c.phones.map((p) => (
            <ItemRow key={p.id ?? p.value} href={messageLink(d.app, p.value, cc)} item={p} isDefault={p === d.messagePhone} onDefault={() => save.mutate({ messagePhoneId: p.id ?? null })} />
          ))}
          <span className={`${menuTitle} border-t border-slate-100`}>App para este contacto</span>
          {onlyInstalled(messagingApps, d.app).map((app) => (
            <button
              key={app}
              type="button"
              className="flex w-full items-center justify-between px-4 py-2 hover:bg-slate-50"
              onClick={() => save.mutate({ messagingApp: app === user?.messagingApp ? null : app })}
            >
              <span>{messagingAppLabels[app]}{app === user?.messagingApp && <span className="text-xs text-slate-400"> · la general</span>}</span>
              {d.app === app && <span className="text-indigo-700">✓</span>}
            </button>
          ))}
        </Split>
      )}
      {d.email && (
        <Split href={emailLink(user?.emailApp, d.email.value)} icon="✉️" label="Email">
          <span className={menuTitle}>Escribir a…</span>
          {c.emails.map((e) => (
            <ItemRow key={e.id ?? e.value} href={emailLink(user?.emailApp, e.value)} item={e} isDefault={e === d.email} onDefault={() => save.mutate({ emailId: e.id ?? null })} />
          ))}
        </Split>
      )}
    </div>
  );
}
