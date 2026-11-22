import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { ContactSummary } from "@agendario/shared";
import { api } from "../lib/api";
import { clearSharedImage, dataUrlToFile, peekSharedImage } from "../lib/shareImage";
import { Avatar } from "../components/Avatar";
import { ContactPicker } from "../components/ContactPicker";
import { useAlert } from "../components/Dialogs";
import { PhotoCropper } from "../components/PhotoCropper";

/** «Compartir» una imagen desde la galería → foto de perfil o portada de un contacto. */
export function ShareImagePage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const showAlert = useAlert();
  const dataUrl = peekSharedImage();
  const file = useMemo(() => (dataUrl ? dataUrlToFile(dataUrl) : null), [dataUrl]);
  const [contact, setContact] = useState<ContactSummary | null>(null);
  const [picking, setPicking] = useState(true);
  const [target, setTarget] = useState<"photo" | "cover" | null>(null);
  const upload = useMutation({
    mutationFn: async ({ f, kind }: { f: File; kind: "photo" | "cover" }) => {
      const fd = new FormData();
      fd.append("photo", f); // el servidor lee siempre el campo «photo» (también para la portada)
      await api.put(`/contacts/${contact!.id}/${kind}`, fd);
    },
    onSuccess: () => {
      clearSharedImage();
      qc.invalidateQueries({ queryKey: ["contact", contact!.id] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      nav(`/contacts/${contact!.id}`, { replace: true });
    },
    onError: (e) => showAlert("No se ha podido guardar la imagen", (e as Error).message),
  });

  if (!dataUrl || !file) return <p className="p-4 text-slate-500">No hay ninguna imagen compartida. Desde la galería, pulsa Compartir → «Poner en un contacto».</p>;
  return (
    <div className="mx-auto max-w-lg space-y-3">
      <h1 className="text-xl font-semibold">🖼️ Poner en un contacto</h1>
      <img src={dataUrl} alt="" className="max-h-72 w-full rounded-2xl bg-slate-100 object-contain" />
      {contact ? (
        <div className="card space-y-3">
          <div className="flex items-center gap-3">
            <Avatar id={contact.id} name={contact.displayName} hasPhoto={contact.hasPhoto} size={40} version={contact.updatedAt} />
            <div className="min-w-0 flex-1 truncate font-medium">{contact.displayName}</div>
            <button className="btn-ghost text-sm" onClick={() => setPicking(true)}>Cambiar</button>
          </div>
          <p className="text-sm text-slate-600">¿Cómo la quieres usar?</p>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-primary" disabled={upload.isPending} onClick={() => setTarget("photo")}>👤 Foto de perfil</button>
            <button className="btn-ghost border border-slate-200" disabled={upload.isPending} onClick={() => setTarget("cover")}>🏞️ Portada</button>
          </div>
          {upload.isPending && <p className="text-sm text-slate-500">Guardando…</p>}
        </div>
      ) : (
        <button className="btn-primary w-full" onClick={() => setPicking(true)}>Elegir contacto</button>
      )}
      <div className="text-center"><button className="btn-ghost text-sm text-slate-500" onClick={() => { clearSharedImage(); nav("/", { replace: true }); }}>Cancelar</button></div>
      {picking && <ContactPicker title="¿A qué contacto se la pones?" onClose={() => setPicking(false)} onPick={(c) => { setContact(c); setPicking(false); }} />}
      {target && (
        <PhotoCropper file={file} aspect={target === "cover" ? 3 : 1} title={target === "cover" ? "Encuadrar la portada" : "Encuadrar la foto"}
          onCancel={() => setTarget(null)} onDone={(f) => { const kind = target; setTarget(null); upload.mutate({ f, kind }); }} />
      )}
    </div>
  );
}
