"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useRooms } from "@/lib/useRooms";
import { type RoomStatus } from "@/lib/types";
import { useActiveStays } from "@/lib/useStays";
import { useCashEntries, usePayables, useReceivables } from "@/lib/finance";
import { useNow } from "@/lib/useNow";
import { DAY_MS, fmtDateTime, startOfDay } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { Alert, Card, EmptyState, Spinner } from "@/components/ui";

// Só mostra indicadores calculados de dados reais. Cartões financeiros só para quem tem acesso ao financeiro.
export default function DashboardPage() {
  const { membership, tenant } = useAuth();
  const t = membership?.tenantId;
  const role = membership?.role ?? "";
  const isFin = ["owner", "admin", "finance"].includes(role);
  const hasStays = ["owner", "admin", "reception", "finance"].includes(role);
  const { rooms, error } = useRooms(t);
  const act = useActiveStays(hasStays ? t : undefined);
  const now = useNow(60000);
  const since = useMemo(() => { const d = startOfDay(new Date()); d.setDate(d.getDate() - 6); return d; }, []);
  const cash = useCashEntries(isFin ? t : undefined, since);
  const pays = usePayables(isFin ? t : undefined);
  const recv = useReceivables(isFin ? t : undefined);

  if (error) return <Alert>{error}</Alert>;
  if (!rooms) return <Spinner />;

  const active = rooms.filter((r) => !r.archived);
  const count = (s: RoomStatus) => active.filter((r) => r.status === s).length;
  const unavailable = count("maintenance") + count("blocked");
  const sellable = active.length - unavailable;
  const occupancy = sellable > 0 ? Math.round((count("occupied") / sellable) * 100) : null;

  const cards: { label: string; value: string; hint?: string }[] = [
    { label: "Total de quartos", value: String(active.length) },
    { label: "Ocupados", value: String(count("occupied")) },
    { label: "Disponíveis", value: String(count("available")) },
    { label: "Em limpeza", value: String(count("awaiting_cleaning") + count("cleaning")), hint: "Aguardando ou em limpeza" },
    { label: "Em manutenção", value: String(count("maintenance")) },
    { label: "Bloqueados", value: String(count("blocked")) },
    {
      label: "Taxa de ocupação",
      value: occupancy === null ? "—" : `${occupancy}%`,
      hint: "Ocupados ÷ quartos que podem receber hóspedes",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Olá! Bem-vindo à {tenant?.displayName || tenant?.name}</h1>
        <p className="text-sm text-slate-600">Situação atual dos quartos.</p>
      </div>

      {active.length === 0 ? (
        <EmptyState
          title="Nenhum quarto cadastrado"
          text="Cadastre os quartos da pousada para começar. Depois você poderá fazer check-ins."
          action={
            <Link href="/painel/quartos/" className="inline-flex rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800">
              Cadastrar quartos
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((c) => (
            <Card key={c.label}>
              <p className="text-sm text-slate-600">{c.label}</p>
              <p className="mt-1 text-3xl font-bold text-slate-900">{c.value}</p>
              {c.hint && <p className="mt-1 text-xs text-slate-500">{c.hint}</p>}
            </Card>
          ))}
        </div>
      )}

      {hasStays && act.stays && (
        <Card>
          <h2 className="mb-2 text-base font-semibold">Hospedagens ativas ({act.stays.length})</h2>
          {act.stays.length === 0 ? <p className="text-sm text-slate-500">Nenhum hóspede na casa agora.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {act.stays.slice(0, 8).map((s) => {
                const left = s.plannedCheckOutAt.getTime() - now;
                return (
                  <li key={s.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <Link href={`/painel/hospedagem/?id=${s.id}`} className="font-medium text-brand-700 hover:underline">Quarto {s.roomNumber} · {s.guestName}</Link>
                    <span className={left < 0 ? "font-medium text-red-700" : left < 2 * 3600000 ? "font-medium text-amber-700" : "text-slate-600"}>{left < 0 ? "Passou do horário · " : "Saída prevista · "}{fmtDateTime(s.plannedCheckOutAt)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {isFin && cash.data && pays.data && recv.data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card><p className="text-sm text-slate-600">Entradas (últimos 7 dias)</p><p className="mt-1 text-2xl font-bold text-emerald-700">{formatCents(cash.data.filter((e) => e.kind === "in" && !e.transfer).reduce((x, e) => x + e.amountCents, 0))}</p></Card>
            <Card><p className="text-sm text-slate-600">Contas a pagar vencidas</p><p className="mt-1 text-2xl font-bold text-red-700">{formatCents(pays.data.filter((p) => p.status === "open" && p.dueDate.getTime() < now).reduce((x, p) => x + p.amountCents, 0))}</p></Card>
            <Card><p className="text-sm text-slate-600">A receber (em aberto)</p><p className="mt-1 text-2xl font-bold">{formatCents(recv.data.filter((r) => r.status === "open").reduce((x, r) => x + r.amountCents - r.receivedCents, 0))}</p></Card>
          </div>
          <FlowChart entries={cash.data} since={since} />
        </>
      )}
    </div>
  );
}

/** Entradas × saídas por dia (7 dias), em SVG simples e acessível. */
function FlowChart({ entries, since }: { entries: { kind: "in" | "out"; amountCents: number; at: Date; transfer: boolean }[]; since: Date }) {
  const days = Array.from({ length: 7 }, (_, i) => new Date(since.getTime() + i * DAY_MS));
  const data = days.map((d) => {
    const end = d.getTime() + DAY_MS;
    const e = entries.filter((x) => !x.transfer && x.at.getTime() >= d.getTime() && x.at.getTime() < end);
    return { d, inn: e.filter((x) => x.kind === "in").reduce((s, x) => s + x.amountCents, 0), out: e.filter((x) => x.kind === "out").reduce((s, x) => s + x.amountCents, 0) };
  });
  const max = Math.max(1, ...data.flatMap((x) => [x.inn, x.out]));
  const H = 120;
  return (
    <Card>
      <h2 className="mb-2 text-base font-semibold">Caixa dos últimos 7 dias</h2>
      <svg viewBox="0 0 350 160" role="img" aria-label="Entradas e saídas por dia" className="w-full max-w-xl">
        {data.map((x, i) => (
          <g key={i} transform={`translate(${i * 50 + 5} 0)`}>
            <rect x="4" y={H - (x.inn / max) * H + 5} width="16" height={(x.inn / max) * H} fill="#059669"><title>{`Entradas ${formatCents(x.inn)}`}</title></rect>
            <rect x="22" y={H - (x.out / max) * H + 5} width="16" height={(x.out / max) * H} fill="#dc2626"><title>{`Saídas ${formatCents(x.out)}`}</title></rect>
            <text x="21" y="148" textAnchor="middle" fontSize="10" fill="#475569">{x.d.getDate()}/{x.d.getMonth() + 1}</text>
          </g>
        ))}
      </svg>
      <p className="mt-1 flex gap-4 text-xs text-slate-600"><span><span className="mr-1 inline-block h-2.5 w-2.5 bg-emerald-600" />Entradas</span><span><span className="mr-1 inline-block h-2.5 w-2.5 bg-red-600" />Saídas</span></p>
    </Card>
  );
}
