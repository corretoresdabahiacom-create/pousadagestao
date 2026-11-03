"use client";

import { useState } from "react";
import { Timestamp, collection, getDocs, query, where } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import { friendlyError, useAuth } from "@/lib/auth/AuthProvider";
import { dreCaixa, dreCompetencia, loadAllCash, parsePayable, parseReceivable, parseRevenue, type Dre } from "@/lib/finance";
import { parseStay } from "@/lib/stays";
import { payLabel } from "@/lib/stays";
import { downloadCsv, downloadXlsx, type Table } from "@/lib/exporters";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";

type Kind = "hospedagens" | "caixa" | "pagar" | "receber" | "dre_comp" | "dre_caixa";
const KINDS: { id: Kind; label: string; finance: boolean }[] = [
  { id: "hospedagens", label: "Hospedagens encerradas", finance: false },
  { id: "caixa", label: "Movimento de caixa", finance: true },
  { id: "pagar", label: "Contas a pagar (por vencimento)", finance: true },
  { id: "receber", label: "Contas a receber (por vencimento)", finance: true },
  { id: "dre_comp", label: "DRE — competência", finance: true },
  { id: "dre_caixa", label: "DRE — caixa", finance: true },
];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function dreTable(title: string, d: Dre): Table {
  return {
    title, headers: ["Grupo", "Categoria", "Valor (R$)"], moneyCols: [2],
    rows: [...d.revenue.map((r) => ["Receita", r.category, r.cents] as (string | number)[]), ["Receita", "TOTAL", d.revenueCents], ...d.expense.map((r) => ["Despesa", r.category, r.cents]), ["Despesa", "TOTAL", d.expenseCents], ["Resultado", "", d.resultCents]],
  };
}

export default function ReportsPage() {
  const { membership } = useAuth();
  const t = membership?.tenantId; const role = membership?.role ?? "";
  const isFin = ["owner", "admin", "finance"].includes(role);
  const [kind, setKind] = useState<Kind>("hospedagens");
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(1); return iso(d); });
  const [to, setTo] = useState(() => iso(new Date()));
  const [table, setTable] = useState<Table | null>(null);
  const [warn, setWarn] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");

  if (!t) return null;
  if (!isFin && role !== "reception") return <Alert>Seu perfil não tem acesso a relatórios.</Alert>;
  const kinds = KINDS.filter((k) => isFin || !k.finance);

  async function generate() {
    setErr(""); setBusy(true); setTable(null); setWarn([]);
    try {
      const a = new Date(`${from}T00:00:00`); const b = new Date(`${to}T00:00:00`); b.setDate(b.getDate() + 1);
      if (isNaN(a.getTime()) || isNaN(b.getTime()) || b <= a) throw new RangeError("Período inválido.");
      if (b.getTime() - a.getTime() > 400 * 86400000) throw new RangeError("Escolha um período de até 13 meses.");
      const { db } = getFirebase();
      const col = (n: string) => collection(db, `tenants/${t}/${n}`);
      const A = Timestamp.fromDate(a), B = Timestamp.fromDate(b);

      if (kind === "hospedagens") {
        const s = await getDocs(query(col("stays"), where("checkedOutAt", ">=", A), where("checkedOutAt", "<", B)));
        const stays = s.docs.map((d) => parseStay(d.id, d.data())).sort((x, y) => (x.checkedOutAt?.getTime() ?? 0) - (y.checkedOutAt?.getTime() ?? 0));
        setTable({ title: "Hospedagens encerradas", headers: ["Hóspede", "Quarto", "Entrada", "Saída", "Diárias", "Total (R$)", "Pago (R$)", "Pendente (R$)"], moneyCols: [5, 6, 7],
          rows: stays.map((x) => [x.guestName, x.roomNumber, x.checkInAt, x.checkedOutAt, x.nights, x.closing?.totalCents ?? 0, x.closing?.paidCents ?? 0, x.closing?.pendingCents ?? 0]) });
      } else if (kind === "caixa") {
        const c = (await loadAllCash(t!, a, b));
        setTable({ title: "Movimento de caixa", headers: ["Data", "Tipo", "Descrição", "Categoria", "Forma", "Valor (R$)", "Transferência"], moneyCols: [5],
          rows: c.map((e) => [e.at, e.kind === "in" ? "Entrada" : "Saída", e.description, e.category, e.method ? payLabel(e.method) : "", e.amountCents, e.transfer ? "Sim" : "Não"]) });
      } else if (kind === "pagar") {
        const s = await getDocs(query(col("accountsPayable"), where("dueDate", ">=", A), where("dueDate", "<", B)));
        const p = s.docs.map((d) => parsePayable(d.id, d.data())).sort((x, y) => x.dueDate.getTime() - y.dueDate.getTime());
        setTable({ title: "Contas a pagar", headers: ["Vencimento", "Fornecedor", "Descrição", "Categoria", "Parcela", "Situação", "Valor (R$)"], moneyCols: [6],
          rows: p.map((x) => [x.dueDate, x.supplier, x.description, x.category, x.installment ?? "", x.status === "paid" ? "Paga" : x.status === "cancelled" ? "Cancelada" : "Em aberto", x.amountCents]) });
      } else if (kind === "receber") {
        const s = await getDocs(query(col("accountsReceivable"), where("dueDate", ">=", A), where("dueDate", "<", B)));
        const r = s.docs.map((d) => parseReceivable(d.id, d.data())).sort((x, y) => x.dueDate.getTime() - y.dueDate.getTime());
        setTable({ title: "Contas a receber", headers: ["Vencimento", "Cliente", "Descrição", "Situação", "Valor (R$)", "Recebido (R$)"], moneyCols: [4, 5],
          rows: r.map((x) => [x.dueDate, x.customerName, x.description, x.status === "received" ? "Recebida" : x.status === "cancelled" ? "Cancelada" : "Em aberto", x.amountCents, x.receivedCents]) });
      } else if (kind === "dre_comp") {
        const [rv, pv] = await Promise.all([getDocs(query(col("revenues"), where("date", ">=", A), where("date", "<", B))), getDocs(query(col("accountsPayable"), where("competenceDate", ">=", A), where("competenceDate", "<", B)))]);
        const d = dreCompetencia(rv.docs.map((x) => parseRevenue(x.id, x.data())), pv.docs.map((x) => parsePayable(x.id, x.data())), a, b);
        setWarn(d.warnings); setTable(dreTable("DRE por competência", d));
      } else {
        const d = dreCaixa(await loadAllCash(t!, a, b), a, b);
        setWarn(d.warnings); setTable(dreTable("DRE por caixa", d));
      }
    } catch (e) { setErr(e instanceof RangeError ? e.message : friendlyError(e)); } finally { setBusy(false); }
  }

  const fname = `${kind}_${from}_a_${to}`;
  const money = new Set(table?.moneyCols ?? []);
  const show = (c: unknown, i: number) => (c === null ? "" : c instanceof Date ? fmtDateTime(c) : typeof c === "number" ? (money.has(i) ? formatCents(c) : String(c)) : String(c));

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-slate-900 print:hidden">Relatórios</h1>
      <Card className="print:hidden">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Relatório"><Select value={kind} onChange={(e) => { setKind(e.target.value as Kind); setTable(null); }}>{kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</Select></Field>
          <Field label="De"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Até"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <div className="flex items-end"><Button onClick={generate} loading={busy} className="w-full">Gerar</Button></div>
        </div>
      </Card>
      {err && <Alert>{err}</Alert>}
      {warn.map((w) => <Alert key={w} kind="info">{w}</Alert>)}
      {table && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div><h2 className="text-lg font-semibold">{table.title}</h2><p className="text-xs text-slate-500">Período {fmtDate(new Date(`${from}T12:00:00`))} a {fmtDate(new Date(`${to}T12:00:00`))} · {table.rows.length} linha(s)</p></div>
            <div className="flex flex-wrap gap-2 print:hidden">
              <Button variant="secondary" onClick={() => downloadCsv(table, fname)}>CSV</Button>
              <Button variant="secondary" onClick={() => downloadXlsx(table, fname).catch((e) => setErr(friendlyError(e)))}>Excel (XLSX)</Button>
              <Button variant="secondary" onClick={() => window.print()}>PDF / Imprimir</Button>
            </div>
          </div>
          {table.rows.length === 0 ? <p className="text-sm text-slate-500">Sem dados no período.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-left text-sm">
              <thead><tr className="border-b border-slate-200 text-slate-600">{table.headers.map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>{table.rows.map((r, i) => <tr key={i} className="border-b border-slate-100">{r.map((c, j) => <td key={j} className="px-2 py-1.5">{show(c, j)}</td>)}</tr>)}</tbody>
            </table></div>
          )}
        </Card>
      )}
    </div>
  );
}
