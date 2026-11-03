"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useActiveStays, useClosedStays } from "@/lib/useStays";
import { fmtDateTime } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import { formatCents } from "@/lib/money";
import type { Stay } from "@/lib/stays";
import { Alert, Badge, Card, EmptyState, Input, Spinner } from "@/components/ui";

export default function StaysPage() {
  const { membership } = useAuth();
  const tenantId = membership?.tenantId;
  const allowed = ["owner", "admin", "reception", "finance"].includes(membership?.role ?? "");
  const [tab, setTab] = useState<"active" | "closed">("active");
  const [q, setQ] = useState("");
  const now = useNow();
  const active = useActiveStays(allowed ? tenantId : undefined);
  const closed = useClosedStays(allowed && tab === "closed" ? tenantId : undefined);

  if (!allowed) return <Alert>Seu perfil não tem acesso às hospedagens.</Alert>;
  const cur = tab === "active" ? active : closed;
  if (cur.error) return <Alert>{cur.error}</Alert>;
  if (!cur.stays) return <Spinner />;

  const s = q.trim().toLowerCase();
  const list = cur.stays.filter((x) => !s || x.guestName.toLowerCase().includes(s) || x.roomNumber.toLowerCase().includes(s));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Hospedagens</h1>
          <p className="text-sm text-slate-600">Hóspedes atuais e histórico.</p>
        </div>
        {membership?.role !== "finance" && (
          <Link href="/painel/checkin/" className="inline-flex rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800">
            Novo check-in
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2" role="tablist">
          {(["active", "closed"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${tab === t ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
              {t === "active" ? "Hospedados agora" : "Encerradas"}
            </button>
          ))}
        </div>
        <div className="min-w-48 flex-1"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por hóspede ou quarto" aria-label="Buscar" /></div>
      </div>

      {list.length === 0 ? (
        <EmptyState title={tab === "active" ? "Nenhum hóspede hospedado" : "Nenhuma hospedagem encerrada"} text="As hospedagens aparecem aqui em tempo real." />
      ) : (
        <Card className="!p-0">
          <ul className="divide-y divide-slate-100">
            {list.map((st: Stay) => {
              const late = st.status === "active" && st.plannedCheckOutAt.getTime() < now;
              return (
                <li key={st.id}>
                  <Link href={`/painel/hospedagem/?id=${st.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                    <div className="min-w-0">
                      <p className="truncate font-medium">Quarto {st.roomNumber} · {st.guestName}</p>
                      <p className="text-sm text-slate-500">
                        {fmtDateTime(st.checkInAt)} → {fmtDateTime(st.status === "closed" ? st.checkedOutAt : st.plannedCheckOutAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {late && <Badge className="bg-red-50 text-red-700 ring-red-600/20">Saída vencida</Badge>}
                      {st.status === "closed" && st.closing && st.closing.pendingCents > 0 && (
                        <Badge className="bg-amber-50 text-amber-800 ring-amber-600/20">Saldo {formatCents(st.closing.pendingCents)}</Badge>
                      )}
                      <span className="text-sm font-semibold">{formatCents(st.status === "closed" ? st.closing?.totalCents : st.totalPlannedCents)}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
