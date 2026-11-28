import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import { AppShell } from "./components/AppShell";
import { RemindersPage } from "./pages/Reminders";
import { NotesPage } from "./pages/Notes";
import { ServerSetup } from "./pages/ServerSetup";
import { getServer, isApp, setServer } from "./lib/platform";
import { CallLogPage } from "./pages/CallLog";
import { HistoryPage } from "./pages/History";
import { TrashPage } from "./pages/Trash";
import { SettingsPage } from "./pages/Settings";
import { Layout } from "./components/Layout";
import { useLogout, useMe } from "./lib/auth";
import { ContactDetailPage } from "./pages/ContactDetail";
import { ContactFormPage } from "./pages/ContactForm";
import { ContactListPage } from "./pages/ContactList";
import { DuplicatesPage } from "./pages/Duplicates";
import { MergePage } from "./pages/Merge";
import { ImportPage } from "./pages/Import";
import { TagsPage } from "./pages/Tags";
import { LoginPage } from "./pages/Login";
import { UpcomingPage } from "./pages/Upcoming";
import { GiftsPage } from "./pages/Gifts";
import { RemoteListPage, WishListFormPage, WishListPage } from "./components/Wishes";
import { ShareGiftPage } from "./pages/ShareGift";
import { ShareImagePage } from "./pages/ShareImage";
import { UnknownCallPage } from "./pages/UnknownCall";

export function App() {
  const [server, setServerState] = useState(getServer());
  const { data: me, isLoading } = useMe(!isApp || !!server);
  const logout = useLogout();
  // «Cambiar de servidor» (menú de usuario o pantalla de entrada): no toca nada hasta confirmar
  const [changing, setChanging] = useState(false);
  useEffect(() => {
    const on = () => setChanging(true);
    window.addEventListener("agendario-change-server", on);
    return () => window.removeEventListener("agendario-change-server", on);
  }, []);
  if (isApp && !server) return <ServerSetup onDone={() => setServerState(getServer())} />;
  if (isApp && changing) {
    return (
      <ServerSetup
        current={server}
        onCancel={() => setChanging(false)}
        onChange={async (base) => { if (me) await logout(); setServer(base); }}
        onDone={() => window.location.reload()}
      />
    );
  }
  if (isLoading) return <div className="p-8 text-center text-slate-500">Cargando…</div>;
  if (!me) return <LoginPage />;

  return (
    <Routes>
      <Route element={isApp ? <AppShell /> : <Layout />}>
        <Route index element={<ContactListPage />} />
        <Route path="contacts/new" element={<ContactFormPage />} />
        <Route path="contacts/:id" element={<ContactDetailPage />} />
        <Route path="contacts/:id/edit" element={<ContactFormPage />} />
        <Route path="upcoming" element={<UpcomingPage />} />
        <Route path="gifts" element={<GiftsPage />} />
        <Route path="gifts/lists/new" element={<WishListFormPage />} />
        <Route path="gifts/lists/:id" element={<WishListPage />} />
        <Route path="gifts/lists/:id/edit" element={<WishListFormPage />} />
        <Route path="gifts/remote" element={<RemoteListPage />} />
        <Route path="reminders" element={<RemindersPage />} />
        <Route path="notes" element={<NotesPage />} />
        {isApp && <Route path="call-log" element={<CallLogPage />} />}
        <Route path="share-gift" element={<ShareGiftPage />} />
        <Route path="share-image" element={<ShareImagePage />} />
        <Route path="unknown-call/:id" element={<UnknownCallPage />} />
        <Route path="tags" element={<TagsPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="duplicates" element={<DuplicatesPage />} />
        <Route path="duplicates/merge" element={<MergePage />} />
        <Route path="contacts/:id/history" element={<HistoryPage />} />
        <Route path="trash" element={<TrashPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
