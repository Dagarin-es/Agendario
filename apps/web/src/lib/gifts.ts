import { useQuery } from "@tanstack/react-query";
import type { PendingGift, UpcomingEvent } from "@agendario/shared";
import { api } from "./api";

/** Regalos comprados sin marcar como regalados cuya fecha ya pasó (aviso en el menú). */
export function usePendingGifts() {
  return useQuery({ queryKey: ["pending-gifts"], queryFn: () => api.get<PendingGift[]>("/upcoming/pending-gifts"), staleTime: 5 * 60_000 });
}

/** Eventos con regalo en los próximos 30 días sin nada comprado (aviso en la pestaña Fechas). */
export function useGiftsToBuy() {
  const { data } = useQuery({ queryKey: ["upcoming", 30], queryFn: () => api.get<UpcomingEvent[]>("/upcoming?days=30"), staleTime: 5 * 60_000 });
  const none = (data ?? []).filter((e) => e.gift === "none").length;
  const ideas = (data ?? []).filter((e) => e.gift === "ideas").length;
  const parts = [none ? `${none} sin ideas` : "", ideas ? `${ideas} con ideas sin comprar` : ""].filter(Boolean);
  return { count: none + ideas, red: none > 0, title: parts.length ? `Próximos 30 días: ${parts.join(", ")}` : "" };
}
