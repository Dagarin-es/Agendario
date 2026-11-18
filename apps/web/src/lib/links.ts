import type { EmailApp, LabeledValue, MessagingApp } from "@agendario/shared";

const isAndroid = () => /Android/i.test(navigator.userAgent);

/** Número en formato internacional sin «+» (p. ej. 34600111222). */
export function intlDigits(raw: string, countryCode: string) {
  const t = raw.trim().replace(/[^\d+]/g, "");
  if (t.startsWith("+")) return t.slice(1);
  if (t.startsWith("00")) return t.slice(2);
  return countryCode + t.replace(/^0+/, "");
}

export const telLink = (raw: string) => `tel:${raw.replace(/[^\d+*#]/g, "")}`;

export function messageLink(app: MessagingApp, raw: string, countryCode: string) {
  const d = intlDigits(raw, countryCode);
  switch (app) {
    case "whatsapp":
      return `https://wa.me/${d}`;
    case "whatsapp_business":
      // En Android se abre directamente WhatsApp Business; en otros sistemas, el enlace general
      return isAndroid() ? `intent://send/?phone=${d}#Intent;scheme=whatsapp;package=com.whatsapp.w4b;end` : `https://wa.me/${d}`;
    case "telegram":
      return `https://t.me/+${d}`;
    case "signal":
      return `https://signal.me/#p/+${d}`;
    case "sms":
      return `sms:+${d}`;
  }
}

/** ¿Parece un móvil? (por la etiqueta o, en España, por empezar por 6 o 7) */
export function isMobileLike(p: LabeledValue) {
  if (/m[oó]vil|mobile|cell|celular|whats/i.test(p.label)) return true;
  const d = p.value.replace(/\D/g, "").replace(/^(0034|34)(?=\d{9}$)/, "");
  return /^[67]\d{8}$/.test(d);
}

export const isWebLink = (href: string) => href.startsWith("http");

/** Enlace para escribir un correo con la app elegida en Ajustes. */
export function emailLink(app: EmailApp | undefined, to: string) {
  const e = encodeURIComponent(to);
  switch (app) {
    case "gmail":
      return `https://mail.google.com/mail/?view=cm&fs=1&to=${e}`;
    case "outlook":
      return `https://outlook.live.com/mail/0/deeplink/compose?to=${e}`;
    case "fastmail":
      return `https://app.fastmail.com/mail/compose?to=${e}`;
    case "proton":
      return `https://mail.proton.me/u/0/inbox#compose?to=${e}`;
    default:
      return `mailto:${to}`;
  }
}
