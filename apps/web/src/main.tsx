import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { createStore, del, get, set } from "idb-keyval";
import { APP_VERSION } from "@agendario/shared";
import { OfflineError } from "./lib/api";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { ConfirmProvider } from "./components/Dialogs";
import "./styles.css";
import "./dark.css";
import "./app.css";
import { initTheme } from "./lib/theme";
import { initNative } from "./lib/native";

initTheme();
void initNative();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof OfflineError) && n < 1,
      refetchOnWindowFocus: true,
      // Siempre se intenta: si no hay conexión, la API responde con lo guardado en el dispositivo
      networkMode: "offlineFirst",
      gcTime: 7 * 24 * 3600_000,
    },
    mutations: { networkMode: "offlineFirst" },
  },
});

// Modo sin conexión: las pantallas visitadas se guardan en el dispositivo (las fichas van aparte)
const idb = createStore("agendario-cache", "queries");
const persister = createAsyncStoragePersister({
  storage: { getItem: (k) => get(k, idb), setItem: (k, v) => set(k, v, idb), removeItem: (k) => del(k, idb) },
  throttleTime: 2000,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 7 * 24 * 3600_000,
        buster: APP_VERSION,
        dehydrateOptions: { shouldDehydrateQuery: (q) => q.state.status === "success" && !["contact", "link-preview", "history"].includes(String(q.queryKey[0])) },
      }}
    >
      <BrowserRouter>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </BrowserRouter>
    </PersistQueryClientProvider>
  </StrictMode>,
);
