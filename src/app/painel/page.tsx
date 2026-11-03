"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useRooms } from "@/lib/useRooms";
import { ROOM_STATUS_LABELS, type RoomStatus } from "@/lib/types";
import { Alert, Card, EmptyState, Spinner } from "@/components/ui";

// Só mostra indicadores que já têm dados reais. Os demais (financeiro, hóspedes)
// entram nas próximas fases, para nunca exibir números fictícios.
export default function DashboardPage() {
  const { membership, tenant } = useAuth();
  const { rooms, error } = useRooms(membership?.tenantId);

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
            <Link href="/painel/quartos/" className="inline-flex rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800">
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

      <Card>
        <h2 className="mb-2 text-base font-semibold">Em construção</h2>
        <p className="text-sm text-slate-600">
          Hóspedes, check-in, financeiro e DRE chegam nas próximas etapas. Os indicadores aparecem aqui assim que houver
          dados reais.
        </p>
        <ul className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
          {(Object.keys(ROOM_STATUS_LABELS) as RoomStatus[]).map((s) => (
            <li key={s} className="rounded-full bg-slate-100 px-2.5 py-1">
              {ROOM_STATUS_LABELS[s]}: {count(s)}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
