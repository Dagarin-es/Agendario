import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@agendario/shared";
import { api, ApiError } from "./api";
import { setMediaToken, setToken } from "./platform";

export function useMe(enabled = true) {
  return useQuery({
    queryKey: ["me"],
    enabled,
    queryFn: async () => {
      try {
        const me = await api.get<User & { mediaToken?: string }>("/auth/me");
        if (me.mediaToken) setMediaToken(me.mediaToken); // app de Android: token para fotos y descargas
        return me;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: Infinity,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    await api.post("/auth/logout").catch(() => undefined);
    setToken(null);
    qc.clear();
    qc.setQueryData(["me"], null);
  };
}
