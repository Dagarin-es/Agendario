/**
 * Aviso de «Agendario es autoalojado» (solo en la app): primera pantalla y pantalla de inicio de sesión.
 * Pensado también para la revisión de Google Play: si el móvil está en inglés, sale en inglés.
 */
const WEB = "https://dagarin.es/agendario/";
const INSTALL = "https://dagarin.es/agendario/#instalar";

const en = typeof navigator !== "undefined" && /^en\b/i.test(navigator.language || "");

const T = en
  ? {
      title: "Agendario is self-hosted",
      p1: "Your contacts, notes and calls are yours: they are stored on your own server, not ours. Only you decide who sees them.",
      p2: "To use the app you need your own Agendario server: at home, on a NAS or on your own server. It's free and open source.",
      short: "Agendario is self-hosted: your data is stored on your server.",
      discover: "Discover Agendario",
      install: "How to install it",
    }
  : {
      title: "Agendario es autoalojado",
      p1: "Tus contactos, notas y llamadas son tuyos: se guardan en tu propio servidor, no en el nuestro. Solo tú decides quién los ve.",
      p2: "Para usar la app necesitas tener instalado tu servidor de Agendario: en casa, en un NAS o en un servidor propio. Es gratuito y de código abierto.",
      short: "Agendario es autoalojado: tus datos se guardan en tu servidor.",
      discover: "Conoce Agendario",
      install: "Cómo instalarlo",
    };

function Links({ small }: { small?: boolean }) {
  const cls = small
    ? "font-medium text-indigo-700 underline"
    : "inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-white/70 px-3.5 py-2 text-sm font-medium text-indigo-800 active:bg-indigo-100";
  return (
    <span className={small ? "inline" : "mt-3 flex flex-wrap gap-2"}>
      <a className={cls} href={WEB} target="_blank" rel="noopener noreferrer">{T.discover} ↗</a>
      {small && <span aria-hidden="true"> · </span>}
      <a className={cls} href={INSTALL} target="_blank" rel="noopener noreferrer">{T.install} ↗</a>
    </span>
  );
}

export function SelfHostedNotice({ compact }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="text-center text-xs leading-relaxed text-slate-500">
        🏠 {T.short} <Links small />
      </p>
    );
  }
  return (
    <div className="rounded-3xl bg-indigo-50 p-4 text-sm text-slate-700 ring-1 ring-indigo-100">
      <p className="mb-1.5 text-base font-semibold text-indigo-950">🏠 {T.title}</p>
      <p className="mb-1.5">{T.p1}</p>
      <p>{T.p2}</p>
      <Links />
    </div>
  );
}
