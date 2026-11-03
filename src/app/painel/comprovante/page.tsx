"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useStay } from "@/lib/useStays";
import { chargeLabel, computeAccount, payLabel } from "@/lib/stays";
import { fmtDateTime } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { Alert, Button, Spinner } from "@/components/ui";

export default function ReceiptPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Receipt />
    </Suspense>
  );
}

interface Pub {
  displayName?: string;
  phone?: string;
  whatsapp?: string;
  address?: string;
  city?: string;
  state?: string;
  logoDataUrl?: string;
}

function Receipt() {
  const id = useSearchParams().get("id");
  const { membership } = useAuth();
  const tenantId = membership?.tenantId;
  const allowed = ["owner", "admin", "reception", "finance"].includes(membership?.role ?? "");
  const { stay, charges, payments, error } = useStay(allowed ? tenantId : undefined, id);
  const [pub, setPub] = useState<Pub>({});

  useEffect(() => {
    if (!tenantId) return;
    const { db } = getFirebase();
    getDoc(doc(db, `tenants/${tenantId}/publicInfo/main`)).then((s) => setPub((s.data() as Pub) ?? {})).catch(() => undefined);
  }, [tenantId]);

  if (!allowed) return <Alert>Seu perfil não pode emitir comprovantes.</Alert>;
  if (error) return <Alert>{error}</Alert>;
  if (!stay) return stay === null ? <Alert>Hospedagem não encontrada.</Alert> : <Spinner />;

  const acc = computeAccount(stay, charges, payments);
  const active = charges.filter((c) => c.status === "active");

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex justify-end gap-2 print:hidden">
        <Button onClick={() => window.print()}>Imprimir / salvar em PDF</Button>
      </div>
      <article className="rounded-xl border border-slate-200 bg-white p-8 text-sm print:border-0 print:p-0">
        <header className="mb-6 flex items-center gap-4 border-b border-slate-200 pb-4">
          {pub.logoDataUrl && <img src={pub.logoDataUrl} alt="" className="h-14 max-w-40 object-contain" />}
          <div>
            <h1 className="text-lg font-bold">{pub.displayName || "Pousada"}</h1>
            <p className="text-slate-600">{[pub.address, pub.city, pub.state].filter(Boolean).join(", ")}</p>
            <p className="text-slate-600">{[pub.phone, pub.whatsapp].filter(Boolean).join(" · ")}</p>
          </div>
        </header>
        <h2 className="mb-3 text-base font-semibold">Comprovante de hospedagem e pagamento</h2>
        <dl className="mb-4 grid grid-cols-2 gap-2">
          <div><dt className="text-slate-500">Hóspede</dt><dd className="font-medium">{stay.guestName}</dd></div>
          <div><dt className="text-slate-500">Quarto</dt><dd className="font-medium">{stay.roomNumber}</dd></div>
          <div><dt className="text-slate-500">Entrada</dt><dd className="font-medium">{fmtDateTime(stay.checkInAt)}</dd></div>
          <div><dt className="text-slate-500">{stay.status === "closed" ? "Saída" : "Saída prevista"}</dt><dd className="font-medium">{fmtDateTime(stay.status === "closed" ? stay.checkedOutAt : stay.plannedCheckOutAt)}</dd></div>
        </dl>
        <table className="mb-4 w-full">
          <tbody>
            <tr><td className="py-1">Hospedagem ({stay.nights} × {formatCents(stay.dailyRateCents)})</td><td className="text-right">{formatCents(acc.lodgingCents)}</td></tr>
            {acc.feesCents > 0 && <tr><td className="py-1">Taxas</td><td className="text-right">{formatCents(acc.feesCents)}</td></tr>}
            {active.map((c) => (<tr key={c.id}><td className="py-1">{c.description} ({chargeLabel(c.category)}) · {c.quantity} × {formatCents(c.unitCents)}</td><td className="text-right">{formatCents(c.totalCents)}</td></tr>))}
            {acc.discountCents > 0 && <tr><td className="py-1">Desconto</td><td className="text-right">− {formatCents(acc.discountCents)}</td></tr>}
            <tr className="border-t border-slate-300 font-semibold"><td className="py-1.5">Total</td><td className="text-right">{formatCents(acc.totalCents)}</td></tr>
          </tbody>
        </table>
        <h3 className="mb-1 font-semibold">Pagamentos</h3>
        {payments.length === 0 ? <p className="mb-3 text-slate-500">Nenhum pagamento registrado.</p> : (
          <table className="mb-3 w-full"><tbody>
            {payments.map((p) => (<tr key={p.id}><td className="py-1">{fmtDateTime(p.createdAt)} · {p.kind === "refund" ? "Estorno" : "Pagamento"} · {payLabel(p.method)}</td><td className="text-right">{p.kind === "refund" ? "− " : ""}{formatCents(p.amountCents)}</td></tr>))}
          </tbody></table>
        )}
        <p className="flex justify-between border-t border-slate-300 pt-2 font-semibold"><span>Saldo pendente</span><span>{formatCents(Math.max(0, acc.pendingCents))}</span></p>
        <p className="mt-6 text-xs text-slate-500">Documento gerencial emitido pelo sistema. Não substitui nota fiscal.</p>
      </article>
    </div>
  );
}
