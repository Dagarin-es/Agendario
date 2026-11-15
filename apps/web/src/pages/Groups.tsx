import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Group } from "@agendario/shared";
import { api } from "../lib/api";
import { useMe } from "../lib/auth";
import { useConfirm } from "../components/Dialogs";

type UserLite = { id: string; name: string; email: string };

export function GroupsPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: groups } = useQuery({ queryKey: ["groups"], queryFn: () => api.get<Group[]>("/groups") });
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: () => api.get<UserLite[]>("/users") });
  const [name, setName] = useState("");
  const confirm = useConfirm();
  const refresh = () => qc.invalidateQueries({ queryKey: ["groups"] });

  const create = useMutation({ mutationFn: () => api.post("/groups", { name }), onSuccess: () => { setName(""); refresh(); } });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/groups/${id}`), onSuccess: refresh });
  const addMember = useMutation({ mutationFn: ({ g, u }: { g: string; u: string }) => api.post(`/groups/${g}/members`, { userId: u }), onSuccess: refresh });
  const removeMember = useMutation({ mutationFn: ({ g, u }: { g: string; u: string }) => api.del(`/groups/${g}/members/${u}`), onSuccess: refresh });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Grupos</h1>
      <p className="text-sm text-slate-500">
        Un grupo (p. ej. «Familia») te permite compartir contactos con varias personas a la vez.
        Los usuarios nuevos se crean registrándose en el servidor.
      </p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
        <input className="input" placeholder="Nombre del grupo" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-primary shrink-0">Crear grupo</button>
      </form>

      {groups?.map((g) => {
        const mine = g.ownerId === me?.id;
        const memberIds = new Set(g.members.map((m) => m.id));
        const candidates = users?.filter((u) => !memberIds.has(u.id)) ?? [];
        return (
          <section key={g.id} className="card">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">👥 {g.name}</h2>
              {mine && <button className="btn-danger" onClick={async () => (await confirm({ title: `¿Borrar el grupo «${g.name}»?`, message: "Los contactos compartidos con este grupo dejarán de verlos sus miembros.", confirmText: "Borrar grupo", danger: true })) && del.mutate(g.id)}>Borrar</button>}
            </div>
            <ul className="mb-3 space-y-1">
              {g.members.map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1">{m.name}{m.id === g.ownerId ? " (propietario)" : ""}</span>
                  {mine && m.id !== g.ownerId && (
                    <button className="btn-danger text-xs" onClick={() => removeMember.mutate({ g: g.id, u: m.id })}>Quitar</button>
                  )}
                </li>
              ))}
            </ul>
            {mine && candidates.length > 0 && (
              <select className="input" value="" onChange={(e) => e.target.value && addMember.mutate({ g: g.id, u: e.target.value })}>
                <option value="">+ Añadir miembro…</option>
                {candidates.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
              </select>
            )}
          </section>
        );
      })}
    </div>
  );
}
