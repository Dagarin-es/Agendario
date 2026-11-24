import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, type InteractionAttachment } from "@agendario/shared";
import { api, apiUrl } from "../lib/api";
import { isApp } from "../lib/platform";
import { useAlert, useConfirm } from "./Dialogs";

/** «1,2 MB», «830 KB» */
export const fileSize = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/** Icono según el tipo de archivo. */
export function fileIcon(mime: string, name = "") {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("image/")) return "🖼️";
  if (mime === "application/pdf") return "📕";
  if (mime.startsWith("audio/")) return "🎵";
  if (/word|opendocument\.text/.test(mime) || ["doc", "docx", "odt"].includes(ext)) return "📘";
  if (/excel|sheet|spreadsheet/.test(mime) || ["xls", "xlsx", "ods", "csv"].includes(ext)) return "📗";
  if (/powerpoint|presentation/.test(mime) || ["ppt", "pptx", "odp"].includes(ext)) return "📙";
  return "📄";
}

export const attachmentUrl = (a: InteractionAttachment, download = false) => apiUrl(`/attachments/${a.id}${download ? "?download=1" : ""}`);

/** Comprueba tamaño antes de subir (el servidor vuelve a comprobarlo todo). */
export function tooBig(f: File) {
  return f.size > ATTACHMENT_MAX_BYTES;
}

/** Sube uno o varios archivos a una llamada (o a una llamada de un número desconocido). */
export async function uploadAttachments(path: string, files: File[]) {
  for (const f of files) {
    const fd = new FormData();
    fd.append("file", f, f.name);
    await api.post(path, fd);
  }
}

/** Botón «📎 Adjuntar» con el selector de archivos del sistema (en el móvil ofrece también la cámara). */
export function AttachButton({ onFiles, small }: { onFiles: (files: File[]) => void; small?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const showAlert = useAlert();
  return (
    <>
      <button type="button" className={`btn-ghost ${small ? "px-2 py-1 text-xs" : "px-2 text-sm"}`} onClick={() => ref.current?.click()}>📎 Adjuntar</button>
      <input
        ref={ref}
        type="file"
        multiple
        hidden
        accept={ATTACHMENT_ACCEPT}
        onChange={(e) => {
          const list = [...(e.target.files ?? [])];
          e.target.value = "";
          const big = list.filter(tooBig);
          if (big.length) showAlert("Archivo demasiado grande", `El máximo es 25 MB por archivo: ${big.map((f) => f.name).join(", ")}`);
          const ok = list.filter((f) => !tooBig(f));
          if (ok.length) onFiles(ok);
        }}
      />
    </>
  );
}

/** Lista de adjuntos: miniatura en las fotos, icono en lo demás. Tocar abre o descarga. */
export function AttachmentList({ items, onChanged, canDelete = true, compact }: {
  items: InteractionAttachment[]; onChanged?: () => void; canDelete?: boolean; compact?: boolean;
}) {
  const confirm = useConfirm();
  const showAlert = useAlert();
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/attachments/${id}`),
    onSuccess: onChanged,
    onError: (e) => showAlert("No se ha podido borrar", (e as Error).message),
  });
  if (!items.length) return null;
  return (
    <ul className={`flex flex-wrap gap-2 ${compact ? "mt-1" : "mt-2"}`}>
      {items.map((a) => (
        <li key={a.id} className="group relative">
          <a
            href={attachmentUrl(a)}
            target="_blank"
            rel="noreferrer"
            className={`flex items-center gap-2 rounded-lg border border-slate-200 bg-white pr-2 text-left text-xs hover:border-indigo-300 ${compact ? "max-w-[13rem]" : "max-w-[16rem]"}`}
            title={`${a.name} · ${fileSize(a.size)}${isApp ? "" : " · se abre en una pestaña nueva"}`}
          >
            {a.hasThumb ? (
              <img src={apiUrl(`/attachments/${a.id}/thumb`)} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-l-lg object-cover" />
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-l-lg bg-slate-50 text-xl" aria-hidden="true">{fileIcon(a.mime, a.name)}</span>
            )}
            <span className="min-w-0">
              <span className="block truncate font-medium text-slate-800">{a.name}</span>
              <span className="block text-slate-500">{fileSize(a.size)}</span>
            </span>
          </a>
          {canDelete && (
            <button
              type="button"
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-[10px] text-white shadow"
              aria-label={`Borrar ${a.name}`}
              onClick={async () => (await confirm({ title: `¿Borrar «${a.name}»?`, message: "Se borra del servidor y no se puede deshacer.", confirmText: "Borrar", danger: true })) && del.mutate(a.id)}
            >✕</button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Archivos elegidos que aún no se han subido (al crear una llamada nueva). */
export function PendingFiles({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  if (!files.length) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`} className="flex items-center gap-1.5 rounded-lg border border-dashed border-indigo-300 bg-white px-2 py-1 text-xs">
          <span aria-hidden="true">{fileIcon(f.type, f.name)}</span>
          <span className="max-w-[10rem] truncate">{f.name}</span>
          <span className="text-slate-500">{fileSize(f.size)}</span>
          <button type="button" className="text-slate-500 hover:text-red-700" onClick={() => onRemove(i)} aria-label={`Quitar ${f.name}`}>✕</button>
        </li>
      ))}
    </ul>
  );
}
