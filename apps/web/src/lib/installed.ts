import { useEffect, useState } from "react";
import type { EmailApp, MessagingApp } from "@agendario/shared";
import { nativeApi } from "./native";
import { isApp } from "./platform";

/** Paquete de Android de cada app (las que no están aquí, como SMS o el correo del sistema, siempre se ofrecen). */
const packages: Partial<Record<MessagingApp | EmailApp, string>> = {
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
