import { useQuery } from "@tanstack/react-query";
import type { PendingGift } from "@agendario/shared";
import { api } from "./api";

/** Regalos comprados sin marcar como regalados cuya fecha ya pasó (aviso en el menú). */
export function usePendingGifts() {
  return useQuery({ queryKey: ["pending-gifts"], queryFn: () => api.get<PendingGift[]>("/upcoming/pending-gifts"), staleTime: 5 * 60_000 });
}
