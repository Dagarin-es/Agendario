import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import type { UpcomingEvent } from "@agendario/shared";
import { Avatar } from "../components/Avatar";
import { api } from "../lib/api";
import { daysLabel, formatDate } from "../lib/format";

export function UpcomingPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useQuery({
    queryKey: ["upcoming", days],
    queryFn: () => api.get<UpcomingEvent[]>(`/upcoming?days=${days}`),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Próximas fechas</h1>
        <select className="input w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>7 días</option>
          <option value={30}>30 días</option>
          <option value={90}>3 meses</option>
          <option value={366}>1 año</option>
        </select>
      </div>
      {isLoading && <p className="text-slate-500">Cargando…</p>}
      {data?.length === 0 && <div className="card text-center text-slate-500">Nada en este periodo.</div>}
      <ul className="space-y-2">
        {data?.map((e, i) => (
          <li key={i}>
            <Link to={`/contacts/${e.contactId}`} className="card flex items-center gap-3 hover:border-indigo-300">
              <Avatar id={e.contactId} name={e.contactName} hasPhoto={e.hasPhoto} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{e.contactName}</div>
                <div className="text-sm text-slate-500">
                  {e.label} · {formatDate(e.date)}
                  {e.turning ? ` · ${e.kind === "birthday" ? "cumple" : "hace"} ${e.turning} años` : ""}
                </div>
                {e.openGiftIdeas > 0 && (
                  <div className="mt-1 text-xs font-medium text-indigo-700">
                    🎁 {e.openGiftIdeas} {e.openGiftIdeas === 1 ? "idea de regalo guardada" : "ideas de regalo guardadas"}
                  </div>
                )}
              </div>
              <span className={`text-sm font-semibold ${e.daysLeft <= 7 ? "text-rose-600" : "text-slate-500"}`}>
                {daysLabel(e.daysLeft)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
