import { Navigate, Route, Routes } from "react-router";
import { HistoryPage } from "./pages/History";
import { TrashPage } from "./pages/Trash";
import { SettingsPage } from "./pages/Settings";
import { Layout } from "./components/Layout";
import { useMe } from "./lib/auth";
import { ContactDetailPage } from "./pages/ContactDetail";
import { ContactFormPage } from "./pages/ContactForm";
import { ContactListPage } from "./pages/ContactList";
import { DuplicatesPage } from "./pages/Duplicates";
import { GroupsPage } from "./pages/Groups";
import { MergePage } from "./pages/Merge";
import { ImportPage } from "./pages/Import";
import { TagsPage } from "./pages/Tags";
import { LoginPage } from "./pages/Login";
import { UpcomingPage } from "./pages/Upcoming";

export function App() {
  const { data: me, isLoading } = useMe();
  if (isLoading) return <div className="p-8 text-center text-slate-500">Cargando…</div>;
  if (!me) return <LoginPage />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<ContactListPage />} />
        <Route path="contacts/new" element={<ContactFormPage />} />
        <Route path="contacts/:id" element={<ContactDetailPage />} />
        <Route path="contacts/:id/edit" element={<ContactFormPage />} />
        <Route path="upcoming" element={<UpcomingPage />} />
        <Route path="groups" element={<GroupsPage />} />
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
