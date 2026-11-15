import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// ---------- Modal genérico ----------

/**
 * Ventana emergente con el estilo de la app. En el móvil ocupa toda la pantalla si `full`;
 * en escritorio se centra. Se cierra con Esc o tocando el fondo.
 */
export function Modal({
  title, onClose, children, footer, size = "md", full,
}: {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  full?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const width = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-5xl" }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        className={`flex w-full flex-col overflow-hidden bg-white shadow-2xl ${width} ${
          full ? "h-dvh sm:h-[90vh] sm:rounded-2xl" : "max-h-[90dvh] rounded-t-2xl sm:rounded-2xl"
        } animate-[dialogIn_.15s_ease-out]`}
      >
        {title !== undefined && (
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <div className="min-w-0 flex-1 font-semibold">{title}</div>
            <button className="btn-ghost -mr-2 px-2.5 text-lg leading-none" onClick={onClose} aria-label="Cerrar">✕</button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Confirmación y avisos ----------

type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  /** Solo un botón «Entendido» (aviso, no pregunta). */
  alert?: boolean;
};
type Ask = (o: ConfirmOptions) => Promise<boolean>;

const ConfirmCtx = createContext<Ask>(async () => false);

/** `const confirm = useConfirm(); if (await confirm({ title: "¿Borrar?", danger: true })) …` */
export const useConfirm = () => useContext(ConfirmCtx);

/** Aviso simple con el diseño de la app (sustituye a alert()). */
export function useAlert() {
  const ask = useConfirm();
  return useCallback((title: string, message?: ReactNode) => ask({ title, message, alert: true }).then(() => undefined), [ask]);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  const ask = useCallback<Ask>((o) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  useEffect(() => {
    if (state) setTimeout(() => okRef.current?.focus(), 0);
  }, [state]);

  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {state && (
        <Modal
          size="sm"
          onClose={() => close(false)}
          footer={
            <>
              {!state.alert && (
                <button className="btn-ghost" onClick={() => close(false)}>{state.cancelText ?? "Cancelar"}</button>
              )}
              <button
                ref={okRef}
                className={state.danger ? "btn bg-red-600 text-white hover:bg-red-700" : "btn-primary"}
                onClick={() => close(true)}
              >
                {state.confirmText ?? (state.alert ? "Entendido" : "Aceptar")}
              </button>
            </>
          }
        >
          <div className="flex gap-3 px-5 py-5">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg ${state.danger ? "bg-red-100 text-red-600" : "bg-indigo-100 text-indigo-700"}`}>
              {state.danger ? "!" : state.alert ? "i" : "?"}
            </div>
            <div className="min-w-0 space-y-1.5">
              <h2 className="font-semibold text-slate-900">{state.title}</h2>
              {state.message && <div className="text-sm text-slate-600">{state.message}</div>}
            </div>
          </div>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}
