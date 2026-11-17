import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { UpcomingEvent } from "@agendario/shared";
import { usePendingGifts } from "../lib/gifts";
import { Avatar } from "../components/Avatar";
import { api } from "../lib/api";
import { daysLabel, formatDate } from "../lib/format";

const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const weekDays = ["L", "M", "X", "J", "V", "S", "D"];
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Color del regalo: rojo sin ideas · amarillo con ideas · verde comprado/regalado · gris otras fechas. */
const giftTone: Record<string, string> = {
  none: "text-red-500",
  ideas: "text-amber-500",
  bought: "text-emerald-600",
  given: "text-emerald-600",
  grey: "text-slate-400",
};
const giftRank = { none: 0, ideas: 1, bought: 2, given: 3, grey: 4 } as const;
type Tone = keyof typeof giftRank;
const toneOf = (e: UpcomingEvent): Tone => e.gift ?? "grey";

export function GiftIcon({ tone, className = "h-4 w-4" }: { tone: Tone; className?: string }) {
  if (tone === "grey") return <span className={`inline-block h-1.5 w-1.5 rounded-full bg-slate-400`} aria-hidden="true" />;
  return (
    <svg viewBox="0 0 24 24" className={`${className} ${giftTone[tone]}`} fill="currentColor" aria-hidden="true">
      <path d="M20 7h-2.2A3 3 0 0 0 12 3.8 3 3 0 0 0 6.2 7H4a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h7V7h2v5h7a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1Zm-11-.1a1 1 0 1 1 1-1V7H9a1 1 0 0 1 0-.1Zm6 .1h-1V5.9a1 1 0 1 1 1 1.1ZM4 13v6a2 2 0 0 0 2 2h5v-8Zm9 8h5a2 2 0 0 0 2-2v-6h-7Z" />
    </svg>
  );
}


function giftText(e: UpcomingEvent) {
  switch (e.gift) {
    case "none": return { text: "Sin ideas de regalo", cls: "text-red-700" };
    case "ideas": return { text: `💡 ${e.openGiftIdeas} ${e.openGiftIdeas === 1 ? "idea de regalo" : "ideas de regalo"}`, cls: "text-amber-700" };
    case "bought": return { text: `🛍️ Comprado: ${e.gifts?.map((g) => g.title).join(", ")}`, cls: "text-emerald-700" };
    case "given": return { text: `✓ Regalado: ${e.gifts?.map((g) => g.title).join(", ")}`, cls: "text-emerald-700" };
    default: return null;
  }
}

function EventRow({ e }: { e: UpcomingEvent }) {
  const g = giftText(e);
  return (
    <li>
      <Link to={`/contacts/${e.contactId}`} className="card flex items-center gap-3 hover:border-indigo-300">
        <Avatar id={e.contactId} name={e.contactName} hasPhoto={e.hasPhoto} />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{e.contactName}</div>
          <div className="text-sm text-slate-500">
            {e.label}{e.auto ? " (por el nombre)" : ""} · {formatDate(e.date)}
            {e.turning ? ` · ${e.kind === "birthday" ? "cumple" : "hace"} ${e.turning} años` : ""}
          </div>
          {g && <div className={`mt-1 text-xs font-medium ${g.cls}`}>{g.text}</div>}
        </div>
        <div className="flex flex-col items-end gap-1">
          <GiftIcon tone={toneOf(e)} className="h-5 w-5" />
          <span className={`text-xs font-semibold ${e.daysLeft >= 0 && e.daysLeft <= 7 ? "text-rose-600" : "text-slate-500"}`}>
            {e.daysLeft < 0 ? `Hace ${-e.daysLeft} d` : daysLabel(e.daysLeft)}
          </span>
        </div>
      </Link>
    </li>
  );
}

export function UpcomingPage() {
  const qc = useQueryClient();
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selected, setSelected] = useState<string | null>(null);
  const todayIso = iso(now);

  // Rejilla de 6 semanas empezando en lunes
  const grid = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [cursor]);
  const from = iso(grid[0]!);
  const to = iso(grid[41]!);

  const { data: monthEvents } = useQuery({
    queryKey: ["upcoming", "range", from, to],
    queryFn: () => api.get<UpcomingEvent[]>(`/upcoming/range?from=${from}&to=${to}`),
    placeholderData: (p) => p,
  });
  const { data: next30, isLoading } = useQuery({ queryKey: ["upcoming", 30], queryFn: () => api.get<UpcomingEvent[]>(`/upcoming?days=30`) });
  const { data: pending } = usePendingGifts();
  const markGiven = useMutation({
    mutationFn: (id: string) => api.patch(`/gift-ideas/${id}`, { status: "given" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-gifts"] });
      qc.invalidateQueries({ queryKey: ["upcoming"] });
    },
  });

  const byDay = useMemo(() => {
    const m = new Map<string, UpcomingEvent[]>();
    for (const e of monthEvents ?? []) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return m;
  }, [monthEvents]);

  const isCurrentMonth = cursor.y === now.getFullYear() && cursor.m === now.getMonth();
  const monthPrefix = `${cursor.y}-${pad(cursor.m + 1)}`;
  const list = selected
    ? byDay.get(selected) ?? []
    : isCurrentMonth
      ? next30 ?? []
      : (monthEvents ?? []).filter((e) => e.date.startsWith(monthPrefix));
  const listTitle = selected ? formatDate(selected) : isCurrentMonth ? "Próximos 30 días" : `${monthNames[cursor.m]} ${cursor.y}`;

  const move = (delta: number) => {
    const d = new Date(cursor.y, cursor.m + delta, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
    setSelected(null);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Fechas</h1>

      {/* Regalos comprados sin entregar cuya fecha ya pasó */}
      {pending && pending.length > 0 && (
        <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">🛍️ Regalos comprados que no has marcado como regalados</p>
          <ul className="space-y-1.5">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">
                  <strong>{p.title}</strong> para <Link className="text-indigo-800 underline" to={`/contacts/${p.contactId}`}>{p.contactName}</Link>
                  <span className="text-amber-800"> · {p.eventLabel || "fecha"} ({formatDate(p.givenAt)})</span>
                </span>
                <button className="btn-primary px-2.5 py-1 text-xs" onClick={() => markGiven.mutate(p.id)}>✓ Regalado</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      {/* Calendario (a la derecha en ordenador) */}
      <section className="card p-3 lg:sticky lg:order-2" style={{ top: "calc(var(--header-h, 68px) + 1rem)" }}>
        <div className="mb-2 flex items-center gap-2">
          <button className="btn-ghost px-3" onClick={() => move(-1)} aria-label="Mes anterior">‹</button>
          <h2 className="flex-1 text-center font-semibold text-indigo-950">{monthNames[cursor.m]} {cursor.y}</h2>
          <button className="btn-ghost px-3" onClick={() => move(1)} aria-label="Mes siguiente">›</button>
          {!isCurrentMonth && (
            <button className="btn-ghost px-2.5 text-xs" onClick={() => { setCursor({ y: now.getFullYear(), m: now.getMonth() }); setSelected(null); }}>Hoy</button>
          )}
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-slate-400">
          {weekDays.map((d) => <div key={d} className="py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {grid.map((d) => {
            const k = iso(d);
            const evs = byDay.get(k) ?? [];
            const inMonth = d.getMonth() === cursor.m;
            const tones = [...new Set(evs.map(toneOf))].sort((a, b) => giftRank[a] - giftRank[b]);
            const isToday = k === todayIso;
            const isSel = k === selected;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setSelected(isSel ? null : k)}
                className={`relative flex h-12 flex-col items-center justify-start gap-0.5 rounded-lg pt-0.5 text-sm transition ${
                  isSel ? "bg-indigo-700 text-white" : evs.length ? "bg-indigo-50/60 hover:bg-indigo-100" : "hover:bg-slate-50"
                } ${inMonth ? "" : "opacity-35"}`}
                aria-label={`${d.getDate()} ${monthNames[d.getMonth()]}${evs.length ? `: ${evs.length} ${evs.length === 1 ? "evento" : "eventos"}` : ""}`}
              >
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${isToday && !isSel ? "bg-indigo-700 font-semibold text-white" : ""}`}>{d.getDate()}</span>
                {tones.length > 0 && (
                  <span className={`relative ${isSel ? "rounded bg-white/90 px-0.5" : ""}`}>
                    <GiftIcon tone={tones[0]!} className="h-5 w-5" />
                    {evs.length > 1 && (
                      <span className="absolute -right-2.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-700 px-1 text-[9px] font-bold leading-none text-white">{evs.length}</span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
          <span className="flex items-center gap-1"><GiftIcon tone="none" className="h-3.5 w-3.5" /> Sin ideas</span>
          <span className="flex items-center gap-1"><GiftIcon tone="ideas" className="h-3.5 w-3.5" /> Con ideas</span>
          <span className="flex items-center gap-1"><GiftIcon tone="bought" className="h-3.5 w-3.5" /> Comprado</span>
          <span className="flex items-center gap-1"><GiftIcon tone="grey" /> Otras fechas</span>
        </div>
      </section>

      <div className="space-y-3 lg:order-1">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 font-semibold text-slate-700">{listTitle}</h2>
        {selected && <button className="btn-ghost px-2.5 text-xs" onClick={() => setSelected(null)}>Ver {isCurrentMonth ? "próximos 30 días" : "todo el mes"}</button>}
      </div>
      {isLoading && <p className="text-slate-500">Cargando…</p>}
      {!isLoading && list.length === 0 && <div className="card text-center text-slate-500">Nada en estas fechas.</div>}
      <ul className="space-y-2">
        {list.map((e, i) => <EventRow key={`${e.contactId}-${e.key}-${e.date}-${i}`} e={e} />)}
      </ul>
      </div>
      </div>
    </div>
  );
}
