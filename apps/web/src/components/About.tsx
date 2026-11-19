import { APP_NAME, APP_VERSION, IS_BETA } from "@agendario/shared";
import { Modal } from "./Dialogs";
import { useThemeIcon } from "./Personalize";

/** «Acerca de Agendario» (en el menú de usuario). */
export function AboutModal({ onClose }: { onClose: () => void }) {
  const icon = useThemeIcon();
  return (
    <Modal title={`Acerca de ${APP_NAME}`} onClose={onClose}>
      <div className="flex items-start gap-4 p-4">
        <img src={icon} alt="" className="h-16 w-16 shrink-0" />
        <div className="space-y-2 text-sm">
          <p className="text-base font-semibold">{APP_NAME} <span className="font-normal text-slate-500">v{APP_VERSION}</span> {IS_BETA && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">BETA</span>}</p>
          <p className="text-slate-600">Agenda de contactos vitaminada, sincronizada, con recordatorios de regalos, copias automáticas, búsqueda de duplicados… Todo lo que siempre has echado de menos en tu gestor de contactos y más aún.</p>
          <p className="text-xs text-slate-400">Autoalojado: tus contactos viven en tu servidor.</p>
        </div>
      </div>
    </Modal>
  );
}
