/**
 * Logos de servicios externos para las fichas de Ajustes. SVG incrustados (sin cargarlos de internet:
 * la CSP y el modo sin conexión). Gmail y Todoist: colección «SVG Logos» de Gil Barbara (CC0).
 */
const box = "h-5 w-5 shrink-0";

export function GmailLogo({ className = box }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 204" className={className} role="img" aria-label="Gmail" dangerouslySetInnerHTML={{ __html: '<defs><linearGradient id="gmA" x1="165" x2="165" y1="44" y2="166" gradientUnits="userSpaceOnUse"><stop stop-color="#60d673"/><stop offset=".17" stop-color="#42c868"/><stop offset=".39" stop-color="#0ebc5f"/><stop offset=".62" stop-color="#00a9bb"/><stop offset=".86" stop-color="#3c90ff"/><stop offset="1" stop-color="#3186ff"/></linearGradient><linearGradient id="gmB" x1="8" x2="184" y1="46.13" y2="46.13" gradientUnits="userSpaceOnUse"><stop offset=".08" stop-color="#ff63a0"/><stop offset=".3" stop-color="#fc413d"/><stop offset=".5" stop-color="#fc413d"/><stop offset=".65" stop-color="#fc413d"/><stop offset=".72" stop-color="#fc5c30"/><stop offset=".86" stop-color="#feb10c"/><stop offset=".91" stop-color="#fec700"/><stop offset=".96" stop-color="#ffdb0f"/></linearGradient></defs><path fill="url(#gmA)" d="M146 44h38v110c0 6.627-5.373 12-12 12h-20a6 6 0 0 1-6-6z" transform="translate(-11.636 -37.818)scale(1.45454)"/><path fill="#fc413d" d="M55.273 26.182H0v160c0 9.638 7.816 17.454 17.455 17.454h29.09a8.727 8.727 0 0 0 8.728-8.728z"/><path fill="url(#gmB)" d="M39.226 30.456c-8.033-6.752-20.018-5.714-26.77 2.319c-6.752 8.032-5.714 20.017 2.319 26.77l76.078 63.949a8 8 0 0 0 10.295 0l76.078-63.95c8.032-6.752 9.07-18.737 2.318-26.77c-6.752-8.032-18.737-9.07-26.769-2.318L96 78.18z" transform="translate(-11.636 -37.818)scale(1.45454)"/>' }} />
  );
}

export function TodoistLogo({ className = box }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 256" className={className} role="img" aria-label="Todoist" dangerouslySetInnerHTML={{ __html: '<path fill="#e44332" d="M224.002 0H31.998C14.358.04.061 14.337 0 32v192c0 17.6 14.397 32 31.998 32h192.004c17.6 0 31.998-14.4 31.998-32V32c0-17.6-14.397-32-31.998-32"/><path fill="#fff" d="M54.133 120.802c4.463-2.606 100.343-58.325 102.535-59.616c2.192-1.275 2.311-5.196-.16-6.615c-2.454-1.41-7.117-4.089-8.846-5.117a8.03 8.03 0 0 0-7.907.096c-1.227.717-83.151 48.299-85.885 49.86c-3.292 1.882-7.333 1.914-10.6 0L0 74.019v21.583c10.52 6.2 36.718 21.599 43.062 25.225c3.786 2.152 7.413 2.105 11.079-.024"/><path fill="#fff" d="M54.133 161.61c4.463-2.607 100.343-58.326 102.535-59.617c2.192-1.275 2.311-5.196-.16-6.615c-2.454-1.41-7.117-4.089-8.846-5.117a8.03 8.03 0 0 0-7.907.096c-1.227.717-83.151 48.298-85.885 49.86c-3.292 1.882-7.333 1.913-10.6 0L0 114.826v21.583c10.52 6.2 36.718 21.599 43.062 25.225c3.786 2.152 7.413 2.104 11.079-.024"/><path fill="#fff" d="M54.133 204.967c4.463-2.607 100.343-58.326 102.535-59.617c2.192-1.275 2.311-5.196-.16-6.615c-2.454-1.41-7.117-4.088-8.846-5.117a8.03 8.03 0 0 0-7.907.096c-1.227.717-83.151 48.299-85.885 49.86c-3.292 1.882-7.333 1.914-10.6 0L0 158.183v21.583c10.52 6.2 36.718 21.6 43.062 25.225c3.786 2.152 7.413 2.105 11.079-.023"/>' }} />
  );
}
