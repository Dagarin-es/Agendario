import { useEffect, useState } from "react";
import type { EmailApp, MessagingApp } from "@agendario/shared";
import { nativeApi, type MailApp } from "./native";
import { isApp } from "./platform";

/** Paquete de Android de cada app (las que no están aquí, como SMS o el correo del sistema, siempre se ofrecen). */
export const packages: Partial<Record<MessagingApp | EmailApp, string>> = {
  whatsapp: "com.whatsapp",
  whatsapp_business: "com.whatsapp.w4b",
  telegram: "org.telegram.messenger",
  signal: "org.thoughtcrime.securesms",
  gmail: "com.google.android.gm",
  outlook: "com.microsoft.office.outlook",
  fastmail: "com.fastmail.app",
  proton: "ch.protonmail.android",
};

let cache: Record<string, boolean> | null = null;

let mailCache: MailApp[] | null = null;
/** Apps de correo instaladas en el teléfono (solo en la app). */
export function useMailApps() {
  const [apps, setApps] = useState<MailApp[] | null>(mailCache);
  useEffect(() => {
    if (!isApp || mailCache) return;
    void nativeApi.mailApps?.().then((r) => { mailCache = r; setApps(r); }).catch(() => undefined);
  }, []);
  return apps ?? [];
}

/** En la app, escribe el correo con la app nativa: la elegida en Ajustes si está instalada; si no, la predeterminada. */
export function openMailNative(to: string, app?: EmailApp | string) {
  const pkg = app && app.includes(".") ? app : app ? packages[app as EmailApp] : undefined;
  return nativeApi.openMail?.(to, pkg).catch(() => { window.location.href = `mailto:${to}`; });
}

/** En la app de Android, filtra la lista a las apps instaladas (más la elegida ahora). En la web, todas. */
export function useInstalledFilter() {
  const [installed, setInstalled] = useState<Record<string, boolean> | null>(cache);
  useEffect(() => {
    if (!isApp || cache) return;
    const t = setTimeout(() => {
      void nativeApi.installedApps?.(Object.values(packages) as string[]).then((r) => { cache = r; setInstalled(r); }).catch(() => undefined);
    }, 0);
    return () => clearTimeout(t);
  }, []);
  return <T extends string>(list: readonly T[], current?: T) =>
    list.filter((a) => a === current || !installed || !packages[a as MessagingApp] || installed[packages[a as MessagingApp]!] !== false);
}
