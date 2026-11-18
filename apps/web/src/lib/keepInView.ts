/**
 * Para menús desplegables: si al abrirse se salen de la pantalla por un lado, los desplaza hacia dentro
 * (con 8 px de margen). Se usa como ref: <div ref={keepInView} …>.
 */
export function keepInView(el: HTMLElement | null) {
  if (!el) return;
  el.style.transform = "";
  requestAnimationFrame(() => {
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    let dx = 0;
    if (r.width > vw - 16) {
      el.style.maxWidth = `${vw - 16}px`;
    }
    const r2 = el.getBoundingClientRect();
    if (r2.left < 8) dx = 8 - r2.left;
    else if (r2.right > vw - 8) dx = vw - 8 - r2.right;
    if (dx) el.style.transform = `translateX(${dx}px)`;
  });
}
