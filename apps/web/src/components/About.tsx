import { APP_NAME, APP_VERSION, IS_BETA } from "@agendario/shared";
import { Modal } from "./Dialogs";
import { useThemeIcon } from "./Personalize";
import { manualUrl } from "../lib/platform";

/** «Acerca de Agendario» (en el menú de usuario), con el manual y el changelog. */
export function AboutModal({ onClose, onNews }: { onClose: () => void; onNews: () => void }) {
  const icon = useThemeIcon();
  return (
    <Modal title={`Acerca de ${APP_NAME}`} onClose={onClose}>
      <div className="flex items-start gap-4 p-4">
        <img src={icon} alt="" className="h-16 w-16 shrink-0" />
        <div className="min-w-0 space-y-2 text-sm">
          <p className="text-base font-semibold">{APP_NAME} <span className="font-normal text-slate-500">v{APP_VERSION}</span> {IS_BETA && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">BETA</span>}</p>
          <p className="text-slate-600">Agenda de contactos vitaminada, sincronizada, con recordatorios de regalos, copias automáticas, búsqueda de duplicados… Todo lo que siempre has echado de menos en tu gestor de contactos y más aún.</p>
          <p className="text-xs text-slate-400">Autoalojado: tus contactos viven en tu servidor.</p>
          <p className="text-xs text-slate-500">🎁 Gracias a <a href="https://emilcar.fm" target="_blank" rel="noopener" className="text-indigo-700 hover:underline">Emilcar.fm</a> y a <a href="https://danaus.app" target="_blank" rel="noopener" className="text-indigo-700 hover:underline">Danaus</a>, su app de regalos, de donde salió la idea de la gestión de regalos.</p>
          <div className="flex flex-wrap gap-2 pt-2">
            <a className="btn-ghost border border-slate-200" href={manualUrl()} target="_blank" rel="noopener">📘 Manual (PDF)</a>
            <button type="button" className="btn-ghost border border-slate-200" onClick={onNews}>📋 Changelog {APP_VERSION}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
