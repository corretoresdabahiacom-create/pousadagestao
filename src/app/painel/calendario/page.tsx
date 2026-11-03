"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useRooms } from "@/lib/useRooms";
import { useActiveStays, useClosedStays } from "@/lib/useStays";
import { DAY_MS, fmtDateTime, startOfDay } from "@/lib/format";
import type { Stay } from "@/lib/stays";
import { Alert, Button, Spinner } from "@/components/ui";

const SPANS = [{ id: 7, label: "Semana" }, { id: 14, label: "14 dias" }, { id: 30, label: "Mês" }] as const;

export default function CalendarPage() {
  const { membership } = useAuth();
  const t = membership?.tenantId;
  const allowed = ["owner", "admin", "reception", "finance"].includes(membership?.role ?? "");
  const { rooms } = useRooms(allowed ? t : undefined);
  const active = useActiveStays(allowed ? t : undefined);
  const closed = useClosedStays(allowed ? t : undefined, 150);
  const [span, setSpan] = useState<7 | 14 | 30>(14);
  const [offset, setOffset] = useState(0);

  const start = useMemo(() => { const d = startOfDay(new Date()); d.setDate(d.getDate() + offset); return d; }, [offset]);
  const days = useMemo(() => Array.from({ length: span }, (_, i) => new Date(start.getTime() + i * DAY_MS)), [start, span]);

  if (!allowed) return <Alert>Seu perfil não tem acesso ao calendário.</Alert>;
  if (!rooms || !active.stays || !closed.stays) return active.error ? <Alert>{active.error}</Alert> : <Spinner />;

  const stays = [...active.stays, ...closed.stays];
  const end = new Date(start.getTime() + span * DAY_MS);
  const occupying = (s: Stay) => ({ from: s.checkInAt, to: s.checkedOutAt ?? s.plannedCheckOutAt });
  const cell = (roomId: string, day: Date) => {
    const dEnd = new Date(day.getTime() + DAY_MS);
    return stays.find((s) => { if (s.roomId !== roomId) return false; const o = occupying(s); return o.from < dEnd && o.to > day; });
  };
  const list = rooms.filter((r) => !r.archived);
  const today = startOfDay(new Date()).getTime();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Calendário de ocupação</h1>
        <div className="flex flex-wrap gap-2">
          {SPANS.map((s) => <Button key={s.id} variant={span === s.id ? "primary" : "secondary"} onClick={() => setSpan(s.id)}>{s.label}</Button>)}
          <Button variant="secondary" onClick={() => setOffset(offset - span)}>←</Button>
          <Button variant="secondary" onClick={() => setOffset(0)}>Hoje</Button>
          <Button variant="secondary" onClick={() => setOffset(offset + span)}>→</Button>
        </div>
      </div>
      <p className="text-xs text-slate-500">Mostra hospedagens ativas e as últimas encerradas (a diária conta em períodos de 24 h a partir da entrada). Período: {start.toLocaleDateString("pt-BR")} a {new Date(end.getTime() - DAY_MS).toLocaleDateString("pt-BR")}.</p>
      {list.length === 0 ? <Alert kind="info">Cadastre quartos para ver o calendário.</Alert> : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-medium text-slate-600">Quarto</th>
                {days.map((d) => (
                  <th key={d.getTime()} className={`min-w-10 px-1 py-2 text-center font-medium ${d.getTime() === today ? "bg-brand-50 text-brand-800" : "text-slate-600"}`}>
                    <div>{d.toLocaleDateString("pt-BR", { weekday: "short" }).slice(0, 3)}</div><div>{d.getDate()}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <th className="sticky left-0 z-10 bg-white px-3 py-1.5 text-left font-semibold text-slate-800">{r.number}</th>
                  {days.map((d) => {
                    const s = cell(r.id, d);
                    return (
                      <td key={d.getTime()} className={`h-8 border-l border-slate-100 p-0 ${d.getTime() === today ? "bg-brand-50/60" : ""}`}>
                        {s && (
                          <Link href={`/painel/hospedagem/?id=${s.id}`} title={`${s.guestName} — ${fmtDateTime(s.checkInAt)} até ${fmtDateTime(s.checkedOutAt ?? s.plannedCheckOutAt)}`}
                            className={`block h-7 truncate px-1 leading-7 text-white ${s.status === "active" ? "bg-brand-600" : "bg-slate-400"}`}>
                            {s.guestName.split(" ")[0]}
                          </Link>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="flex gap-4 text-xs text-slate-600"><span><span className="mr-1 inline-block h-3 w-3 bg-brand-600 align-middle" />Ativa</span><span><span className="mr-1 inline-block h-3 w-3 bg-slate-400 align-middle" />Encerrada</span></p>
    </div>
  );
}
