import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Group, Permission, Share, ShareInput } from "@agendario/shared";
import { api } from "../lib/api";

type UserLite = { id: string; name: string; email: string };

/** Panel para elegir con quién se comparte un contacto (solo propietario). */
export function SharePanel({ contactId, shares }: { contactId: string; shares: Share[] }) {
  const qc = useQueryClient();
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: () => api.get<UserLite[]>("/users") });
  const { data: groups } = useQuery({ queryKey: ["groups"], queryFn: () => api.get<Group[]>("/groups") });
  const [pick, setPick] = useState("");

  const save = useMutation({
    mutationFn: (next: ShareInput[]) => api.put(`/contacts/${contactId}/shares`, { shares: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contact", contactId] }),
  });

  const toInput = (s: Share): ShareInput => ({
    ...(s.userId ? { userId: s.userId } : { groupId: s.groupId! }),
    permission: s.permission,
  });
  const current = shares.map(toInput);
  const taken = new Set(shares.map((s) => s.userId ?? s.groupId));

  function add() {
    if (!pick) return;
    const [kind, id] = pick.split(":");
    save.mutate([...current, kind === "u" ? { userId: id, permission: "read" } : { groupId: id, permission: "read" }]);
    setPick("");
  }

  const options = [
    ...(groups ?? []).filter((g) => !taken.has(g.id)).map((g) => ({ v: `g:${g.id}`, l: `👥 ${g.name}` })),
    ...(users ?? []).filter((u) => !taken.has(u.id)).map((u) => ({ v: `u:${u.id}`, l: `${u.name} (${u.email})` })),
  ];

  return (
    <section className="card">
      <h2 className="section-title">Compartido con</h2>
      {shares.length === 0 && <p className="mb-3 text-sm text-slate-500">Todavía con nadie.</p>}
      <ul className="mb-3 space-y-2">
        {shares.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="flex-1 text-sm">{s.groupId ? "👥 " : ""}{s.name}</span>
            <select
              className="input w-auto"
              value={s.permission}
              onChange={(e) => save.mutate(current.map((c, j) => (j === i ? { ...c, permission: e.target.value as Permission } : c)))}
            >
              <option value="read">Puede ver</option>
              <option value="write">Puede editar</option>
            </select>
            <button className="btn-danger" onClick={() => save.mutate(current.filter((_, j) => j !== i))}>✕</button>
          </li>
        ))}
      </ul>
      {options.length > 0 ? (
        <div className="flex gap-2">
          <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Elegir persona o grupo…</option>
            {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <button className="btn-primary" onClick={add} disabled={!pick}>Compartir</button>
        </div>
      ) : (
        <p className="text-xs text-slate-400">No hay más usuarios ni grupos con los que compartir.</p>
      )}
    </section>
  );
}
