/** Imagen compartida desde la galería de Android (se guarda aquí hasta que la pantalla la recoge). */
let shared: string | null = null;

export function setSharedImage(dataUrl: string) {
  shared = dataUrl;
  window.dispatchEvent(new CustomEvent("agendario-share-image"));
}

export function peekSharedImage() {
  return shared;
}

export function clearSharedImage() {
  shared = null;
}

/** data:image/jpeg;base64,… → File */
export function dataUrlToFile(dataUrl: string, name = "compartida.jpg") {
  const [head, b64] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(head ?? "")?.[1] ?? "image/jpeg";
  const bin = atob(b64 ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}
