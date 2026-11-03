"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useAuth, friendlyError } from "@/lib/auth/AuthProvider";
import {
  EXPENSE_CATEGORIES, MANUAL_IN_CATEGORIES, addManualEntry, cancelPayable, closeRegister, createPayables, dreCaixa, dreCompetencia, expectedCash,
  generateRecurring, openRegister, payPayable, receiveReceivable, saveRecurring, useCashEntries, usePayables, useReceivables, useRecurring, useRegisters, useRevenues,
  type Dre, type Payable, type Receivable,
} from "@/lib/finance";
import { PAY_METHODS, payLabel, type PayMethod } from "@/lib/stays";
import { fmtDate, fmtDateTime, newId } from "@/lib/format";
import { formatCents, parseBRLToCents } from "@/lib/money";
import { useNow } from "@/lib/useNow";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner } from "@/components/ui";

type Tab = "caixa" | "pagar" | "receber" | "dre";
const TABS: { id: Tab; label: string }[] = [
  { id: "caixa", label: "Caixa" },
  { id: "pagar", label: "Contas a pagar" },
  { id: "receber", label: "Contas a receber" },
  { id: "dre", label: "Resultado (DRE)" },
];
const inputDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromInputDate = (v: string) => (v ? new Date(`${v}T12:00:00`) : null);

export default function FinancePage() {
  const { membership } = useAuth();
  const [tab, setTab] = useState<Tab>("caixa");
  const allowed = ["owner", "admin", "finance"].includes(membership?.role ?? "");
  if (!allowed) return <Alert>Seu perfil não tem acesso ao financeiro.</Alert>;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-slate-900">Financeiro</h1>
      <div className="flex gap-1 overflow-x-auto rounded-xl bg-white p-1 shadow-sm">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium ${tab === t.id ? "bg-brand-700 text-white" : "text-slate-700 hover:bg-slate-100"}`}>{t.label}</button>
        ))}
      </div>
      {tab === "caixa" && <CashTab />}
      {tab === "pagar" && <PayablesTab />}
      {tab === "receber" && <ReceivablesTab />}
      {tab === "dre" && <DreTab />}
    </div>
  );
}

function useCtx() {
  const { membership, user } = useAuth();
  return { t: membership?.tenantId as string, uid: user?.uid as string };
}
function Money({ cents, tone }: { cents: number; tone?: "in" | "out" }) {
  return <span className={tone === "in" ? "text-emerald-700" : tone === "out" ? "text-red-700" : ""}>{formatCents(cents)}</span>;
}

// ------------------------------------------------------------------ CAIXA
function CashTab() {
  const { t, uid } = useCtx();
  const since = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 62); d.setHours(0, 0, 0, 0); return d; }, []);
  const cash = useCashEntries(t, since);
  const regs = useRegisters(t);
  const [modal, setModal] = useState<"" | "open" | "close" | "in" | "out">("");
  const [err, setErr] = useState("");
  if (cash.error || regs.error) return <Alert>{cash.error || regs.error}</Alert>;
  if (!cash.data || !regs.data) return <Spinner />;
  const open = regs.data.find((r) => r.status === "open");
  const sorted = [...cash.data].sort((a, b) => b.at.getTime() - a.at.getTime());
  const sinceOpen = open ? sorted.filter((e) => e.at >= new Date(open.openedAt.getTime() - 2000)) : [];
  const expected = open ? expectedCash(open, cash.data) : 0;
  const closed = regs.data.filter((r) => r.status === "closed").sort((a, b) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0)).slice(0, 8);

  return (
    <div className="space-y-4">
      {err && <Alert>{err}</Alert>}
      <Card>
        {open ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-600/20">Caixa aberto</Badge>
                <p className="mt-1 text-sm text-slate-600">Aberto em {fmtDateTime(open.openedAt)} com {formatCents(open.openingCents)}</p>
                <p className="text-sm text-slate-600">Dinheiro esperado na gaveta: <strong>{formatCents(expected)}</strong></p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setModal("in")}>+ Entrada</Button>
                <Button variant="secondary" onClick={() => setModal("out")}>− Saída</Button>
                <Button variant="danger" onClick={() => setModal("close")}>Fechar caixa</Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">Nenhum caixa aberto. Abra o caixa para conferir o dinheiro do turno.</p>
            <Button onClick={() => setModal("open")}>Abrir caixa</Button>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">{open ? "Movimentos desde a abertura" : "Últimos movimentos (60 dias)"}</h2>
        <Entries list={(open ? sinceOpen : sorted).slice(0, 80)} />
      </Card>

      {closed.length > 0 && (
        <Card>
          <h2 className="mb-2 font-semibold">Fechamentos anteriores</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {closed.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>{fmtDateTime(r.openedAt)} → {fmtDateTime(r.closedAt)}</span>
                <span>Esperado {formatCents(r.expectedCents ?? 0)} · Contado {formatCents(r.countedCents ?? 0)} · <strong className={(r.differenceCents ?? 0) === 0 ? "text-emerald-700" : "text-red-700"}>Diferença {formatCents(r.differenceCents ?? 0)}</strong></span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {modal === "open" && <OpenModal onClose={() => setModal("")} onSave={(c) => openRegister(t, uid, c).then(() => setModal("")).catch((e) => setErr(friendlyError(e)))} />}
      {modal === "close" && open && <CloseModal expected={expected} onClose={() => setModal("")} onSave={(c, n) => closeRegister(t, uid, open, cash.data!, c, n).then(() => setModal("")).catch((e) => setErr(friendlyError(e)))} />}
      {(modal === "in" || modal === "out") && <EntryModal kind={modal} registerId={open?.id} onClose={() => setModal("")} onSave={async (e) => { try { await addManualEntry(t, uid, e); setModal(""); } catch (x) { setErr(friendlyError(x)); } }} />}
    </div>
  );
}

function Entries({ list }: { list: ReturnType<typeof useCashEntries>["data"] & object }) {
  if (!list.length) return <p className="text-sm text-slate-500">Nenhum movimento.</p>;
  return (
    <ul className="divide-y divide-slate-100 text-sm">
      {list.map((e) => (
        <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2">
          <span>{fmtDateTime(e.at)} · {e.description} <span className="text-slate-500">· {e.category}{e.method ? ` · ${payLabel(e.method)}` : ""}{e.transfer ? " · transferência" : ""}</span></span>
          <strong><Money cents={e.amountCents} tone={e.kind} /></strong>
        </li>
      ))}
    </ul>
  );
}

function OpenModal({ onClose, onSave }: { onClose: () => void; onSave: (c: number) => Promise<void> }) {
  const [v, setV] = useState("0,00"); const [busy, setBusy] = useState(false); const [e, setE] = useState("");
  return (
    <Modal title="Abrir caixa" onClose={onClose}>
      <form className="space-y-3" onSubmit={async (ev: FormEvent) => { ev.preventDefault(); const c = parseBRLToCents(v); if (c === null || c < 0) return setE("Informe um valor válido."); setBusy(true); await onSave(c); setBusy(false); }}>
        <Field label="Dinheiro na gaveta ao abrir (R$)" error={e}><Input inputMode="decimal" value={v} onChange={(x) => setV(x.target.value)} /></Field>
        <Button type="submit" loading={busy}>Abrir caixa</Button>
      </form>
    </Modal>
  );
}
function CloseModal({ expected, onClose, onSave }: { expected: number; onClose: () => void; onSave: (c: number, n: string) => Promise<void> }) {
  const [v, setV] = useState(""); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [e, setE] = useState("");
  const counted = parseBRLToCents(v);
  return (
    <Modal title="Fechar caixa" onClose={onClose}>
      <form className="space-y-3" onSubmit={async (ev: FormEvent) => { ev.preventDefault(); if (counted === null || counted < 0) return setE("Informe o valor contado."); setBusy(true); await onSave(counted, note); setBusy(false); }}>
        <p className="text-sm text-slate-600">Esperado em dinheiro: <strong>{formatCents(expected)}</strong></p>
        <Field label="Dinheiro contado (R$)" error={e}><Input inputMode="decimal" value={v} onChange={(x) => setV(x.target.value)} /></Field>
        {counted !== null && <p className={`text-sm font-medium ${counted === expected ? "text-emerald-700" : "text-red-700"}`}>Diferença: {formatCents(counted - expected)}</p>}
        <Field label="Observação (obrigatória se houver diferença)"><Input value={note} onChange={(x) => setNote(x.target.value)} /></Field>
        <Button type="submit" loading={busy} disabled={counted !== null && counted !== expected && !note.trim()}>Fechar caixa</Button>
      </form>
    </Modal>
  );
}
function EntryModal({ kind, registerId, onClose, onSave }: { kind: "in" | "out"; registerId?: string; onClose: () => void; onSave: (e: Parameters<typeof addManualEntry>[2]) => Promise<void> }) {
  const [amount, setAmount] = useState(""); const [method, setMethod] = useState<PayMethod>("dinheiro"); const [category, setCategory] = useState(kind === "in" ? MANUAL_IN_CATEGORIES[0] : EXPENSE_CATEGORIES[0]);
  const [desc, setDesc] = useState(""); const [transfer, setTransfer] = useState(false); const [busy, setBusy] = useState(false); const [e, setE] = useState(""); const [key] = useState(() => newId());
  const cats = kind === "in" ? MANUAL_IN_CATEGORIES : EXPENSE_CATEGORIES;
  return (
    <Modal title={kind === "in" ? "Entrada manual" : "Saída manual"} onClose={onClose}>
      <form className="space-y-3" onSubmit={async (ev: FormEvent) => { ev.preventDefault(); const c = parseBRLToCents(amount); if (!c || c <= 0) return setE("Informe um valor maior que zero."); if (!desc.trim()) return setE("Descreva o lançamento."); setBusy(true); await onSave({ kind, amountCents: c, method, category, description: desc.trim(), transfer, registerId, key }); setBusy(false); }}>
        {e && <Alert>{e}</Alert>}
        <Field label="Valor (R$)"><Input inputMode="decimal" value={amount} onChange={(x) => setAmount(x.target.value)} /></Field>
        <Field label="Forma"><Select value={method} onChange={(x) => setMethod(x.target.value as PayMethod)}>{PAY_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select></Field>
        <Field label="Categoria"><Select value={category} onChange={(x) => setCategory(x.target.value)} disabled={transfer}>{cats.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Descrição"><Input value={desc} onChange={(x) => setDesc(x.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={transfer} onChange={(x) => setTransfer(x.target.checked)} /> É transferência entre caixas/contas (não entra no resultado)</label>
        <Button type="submit" loading={busy}>Registrar</Button>
      </form>
    </Modal>
  );
}

// -------------------------------------------------------------- A PAGAR
function PayablesTab() {
  const { t, uid } = useCtx();
  const pays = usePayables(t); const rec = useRecurring(t);
  const now = useNow(60000);
  const [filter, setFilter] = useState<"open" | "late" | "paid">("open");
  const [modal, setModal] = useState<"" | "new" | "rec">("");
  const [paying, setPaying] = useState<Payable | null>(null);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  if (pays.error) return <Alert>{pays.error}</Alert>;
  if (!pays.data || !rec.data) return <Spinner />;
  const list = pays.data.filter((p) => (filter === "paid" ? p.status === "paid" : filter === "late" ? p.status === "open" && p.dueDate.getTime() < now : p.status === "open")).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const totalOpen = pays.data.filter((p) => p.status === "open").reduce((s, p) => s + p.amountCents, 0);

  return (
    <div className="space-y-4">
      {msg && <Alert kind="success">{msg}</Alert>}{err && <Alert>{err}</Alert>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Total em aberto: <strong>{formatCents(totalOpen)}</strong></p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={async () => { try { const n = await generateRecurring(t, uid, rec.data!, new Date()); setMsg(n ? `${n} conta(s) recorrente(s) gerada(s) para este mês, em aberto.` : "As contas recorrentes deste mês já foram geradas."); } catch (e) { setErr(friendlyError(e)); } }}>Gerar recorrentes do mês</Button>
          <Button variant="secondary" onClick={() => setModal("rec")}>+ Despesa recorrente</Button>
          <Button onClick={() => setModal("new")}>+ Nova conta</Button>
        </div>
      </div>
      <div className="flex gap-1">{(["open", "late", "paid"] as const).map((f) => <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 text-sm ${filter === f ? "bg-brand-700 text-white" : "bg-white text-slate-700 ring-1 ring-slate-300"}`}>{f === "open" ? "Em aberto" : f === "late" ? "Vencidas" : "Pagas"}</button>)}</div>
      {list.length === 0 ? <EmptyState title="Nada por aqui" text="Nenhuma conta neste filtro." /> : (
        <Card><ul className="divide-y divide-slate-100 text-sm">
          {list.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><strong>{p.supplier || p.description}</strong> {p.supplier && `— ${p.description}`} {p.installment && <Badge className="bg-slate-100 text-slate-700 ring-slate-500/20">{p.installment}</Badge>}<br /><span className="text-slate-500">{p.category} · vence {fmtDate(p.dueDate)}{p.status === "paid" && p.paidAt ? ` · pago ${fmtDate(p.paidAt)} (${payLabel(p.method ?? "")})` : ""}</span></span>
              <span className="flex items-center gap-2"><strong>{formatCents(p.amountCents)}</strong>
                {p.status === "open" && <><Button variant="secondary" onClick={() => setPaying(p)}>Pagar</Button>
                <Button variant="ghost" onClick={async () => { const r = prompt("Motivo do cancelamento:"); if (r?.trim()) { try { await cancelPayable(t, uid, p, r.trim()); } catch (e) { setErr(friendlyError(e)); } } }}>Cancelar</Button></>}
              </span>
            </li>
          ))}
        </ul></Card>
      )}
      {rec.data.length > 0 && <Card><h2 className="mb-2 font-semibold">Despesas recorrentes</h2><ul className="text-sm text-slate-700">{rec.data.map((r) => <li key={r.id}>{r.description} · {r.category} · dia {r.dayOfMonth} · {formatCents(r.amountCents)}</li>)}</ul></Card>}
      {modal === "new" && <PayableModal onClose={() => setModal("")} onSave={async (i) => { try { await createPayables(t, uid, i); setModal(""); } catch (e) { setErr(friendlyError(e)); } }} />}
      {modal === "rec" && <RecurringModal onClose={() => setModal("")} onSave={async (r) => { try { await saveRecurring(t, r); setModal(""); } catch (e) { setErr(friendlyError(e)); } }} />}
      {paying && <PayModal p={paying} onClose={() => setPaying(null)} onSave={async (m, d) => { try { await payPayable(t, uid, paying, m, d); setPaying(null); } catch (e) { setErr(friendlyError(e)); } }} />}
    </div>
  );
}
function PayableModal({ onClose, onSave }: { onClose: () => void; onSave: (i: Parameters<typeof createPayables>[2]) => Promise<void> }) {
  const [f, setF] = useState({ supplier: "", description: "", category: EXPENSE_CATEGORIES[0], amount: "", due: inputDate(new Date()), comp: inputDate(new Date()), n: "1" });
  const [e, setE] = useState(""); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (x: { target: { value: string } }) => setF({ ...f, [k]: x.target.value });
  return (
    <Modal title="Nova conta a pagar" onClose={onClose}>
      <form className="space-y-3" onSubmit={async (ev: FormEvent) => { ev.preventDefault(); const c = parseBRLToCents(f.amount); const due = fromInputDate(f.due); const comp = fromInputDate(f.comp); const n = Math.max(1, Math.min(60, parseInt(f.n) || 1)); if (!c || c <= 0 || !due || !comp || !f.description.trim()) return setE("Preencha descrição, valor e datas."); setBusy(true); await onSave({ supplier: f.supplier.trim(), description: f.description.trim(), category: f.category, amountCents: c, dueDate: due, competenceDate: comp, installments: n }); setBusy(false); }}>
        {e && <Alert>{e}</Alert>}
        <Field label="Fornecedor"><Input value={f.supplier} onChange={set("supplier")} /></Field>
        <Field label="Descrição"><Input value={f.description} onChange={set("description")} /></Field>
        <Field label="Categoria"><Select value={f.category} onChange={set("category")}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor total (R$)"><Input inputMode="decimal" value={f.amount} onChange={set("amount")} /></Field>
          <Field label="Parcelas" hint="Parcelas futuras ficam em aberto"><Input type="number" min={1} max={60} value={f.n} onChange={set("n")} /></Field>
          <Field label="1º vencimento"><Input type="date" value={f.due} onChange={set("due")} /></Field>
          <Field label="Competência" hint="Mês a que a despesa pertence"><Input type="date" value={f.comp} onChange={set("comp")} /></Field>
        </div>
        <Button type="submit" loading={busy}>Salvar</Button>
      </form>
    </Modal>
  );
}
function RecurringModal({ onClose, onSave }: { onClose: () => void; onSave: (r: Parameters<typeof saveRecurring>[1]) => Promise<void> }) {
  const [f, setF] = useState({ supplier: "", description: "", category: EXPENSE_CATEGORIES[0], amount: "", day: "10" }); const [e, setE] = useState("");
  const set = (k: keyof typeof f) => (x: { target: { value: string } }) => setF({ ...f, [k]: x.target.value });
  return (
    <Modal title="Despesa recorrente (mensal)" onClose={onClose}>
      <form className="space-y-3" onSubmit={async (ev: FormEvent) => { ev.preventDefault(); const c = parseBRLToCents(f.amount); if (!c || c <= 0 || !f.description.trim()) return setE("Informe descrição e valor."); await onSave({ supplier: f.supplier.trim(), description: f.description.trim(), category: f.category, amountCents: c, dayOfMonth: Math.min(31, Math.max(1, parseInt(f.day) || 1)), active: true }); }}>
        {e && <Alert>{e}</Alert>}
        <Field label="Fornecedor"><Input value={f.supplier} onChange={set("supplier")} /></Field>
        <Field label="Descrição"><Input value={f.description} onChange={set("description")} /></Field>
        <Field label="Categoria"><Select value={f.category} onChange={set("category")}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Valor (R$)"><Input inputMode="decimal" value={f.amount} onChange={set("amount")} /></Field><Field label="Dia do vencimento"><Input type="number" min={1} max={31} value={f.day} onChange={set("day")} /></Field></div>
        <Button type="submit">Salvar</Button>
      </form>
    </Modal>
  );
}
function PayModal({ p, onClose, onSave }: { p: Payable; onClose: () => void; onSave: (m: PayMethod, d: Date) => Promise<void> }) {
  const [m, setM] = useState<PayMethod>("pix"); const [d, setD] = useState(inputDate(new Date())); const [busy, setBusy] = useState(false);
  return (
    <Modal title="Registrar pagamento" onClose={onClose}>
      <form className="space-y-3" onSubmit={async (ev: FormEvent) => { ev.preventDefault(); const dt = fromInputDate(d); if (!dt) return; setBusy(true); await onSave(m, dt); setBusy(false); }}>
        <p className="text-sm">{p.supplier} — {p.description}: <strong>{formatCents(p.amountCents)}</strong></p>
        <Field label="Forma"><Select value={m} onChange={(x) => setM(x.target.value as PayMethod)}>{PAY_METHODS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></Field>
        <Field label="Data do pagamento"><Input type="date" value={d} onChange={(x) => setD(x.target.value)} /></Field>
        <Button type="submit" loading={busy}>Confirmar pagamento</Button>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------- A RECEBER
function ReceivablesTab() {
  const { t, uid } = useCtx();
  const rec = useReceivables(t); const now = useNow(60000);
  const [sel, setSel] = useState<Receivable | null>(null); const [err, setErr] = useState("");
  if (rec.error) return <Alert>{rec.error}</Alert>;
  if (!rec.data) return <Spinner />;
  const list = rec.data.filter((r) => r.status === "open").sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const total = list.reduce((s, r) => s + (r.amountCents - r.receivedCents), 0);
  return (
    <div className="space-y-4">
      {err && <Alert>{err}</Alert>}
      <p className="text-sm text-slate-600">Total a receber: <strong>{formatCents(total)}</strong></p>
      {list.length === 0 ? <EmptyState title="Nada a receber" text="Saldos de hospedagens fechadas com pendência aparecem aqui." /> : (
        <Card><ul className="divide-y divide-slate-100 text-sm">
          {list.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><strong>{r.customerName}</strong><br /><span className="text-slate-500">{r.description} · vence {fmtDate(r.dueDate)} {r.dueDate.getTime() < now && <Badge className="bg-red-50 text-red-700 ring-red-600/20">Vencida</Badge>}</span></span>
              <span className="flex items-center gap-2"><span className="text-right">{formatCents(r.amountCents - r.receivedCents)}{r.receivedCents > 0 && <span className="block text-xs text-slate-500">de {formatCents(r.amountCents)}</span>}</span><Button variant="secondary" onClick={() => setSel(r)}>Receber</Button></span>
            </li>
          ))}
        </ul></Card>
      )}
      {sel && <ReceiveModal r={sel} onClose={() => setSel(null)} onSave={async (c, m, k) => { try { await receiveReceivable(t, uid, sel, c, m, k); setSel(null); } catch (e) { setErr(friendlyError(e)); } }} />}
    </div>
  );
}
function ReceiveModal({ r, onClose, onSave }: { r: Receivable; onClose: () => void; onSave: (c: number, m: PayMethod, key: string) => Promise<void> }) {
  const left = r.amountCents - r.receivedCents;
  const [v, setV] = useState((left / 100).toFixed(2).replace(".", ",")); const [m, setM] = useState<PayMethod>("pix"); const [e, setE] = useState(""); const [busy, setBusy] = useState(false); const [key] = useState(() => newId());
  return (
    <Modal title="Registrar recebimento" onClose={onClose}>
      <form className="space-y-3" onSubmit={async (ev: FormEvent) => { ev.preventDefault(); const c = parseBRLToCents(v); if (!c || c <= 0 || c > left) return setE(`Informe um valor entre R$ 0,01 e ${formatCents(left)}.`); setBusy(true); await onSave(c, m, key); setBusy(false); }}>
        <p className="text-sm">{r.customerName} — saldo {formatCents(left)} (recebimento parcial permitido)</p>
        <Field label="Valor recebido (R$)" error={e}><Input inputMode="decimal" value={v} onChange={(x) => setV(x.target.value)} /></Field>
        <Field label="Forma"><Select value={m} onChange={(x) => setM(x.target.value as PayMethod)}>{PAY_METHODS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></Field>
        <Button type="submit" loading={busy}>Confirmar</Button>
      </form>
    </Modal>
  );
}

// -------------------------------------------------------------------- DRE
function DreTab() {
  const { t } = useCtx();
  const [month, setMonth] = useState(() => inputDate(new Date()).slice(0, 7));
  const [regime, setRegime] = useState<"competencia" | "caixa">("competencia");
  const [y, m] = month.split("-").map(Number);
  const from = useMemo(() => new Date(y, m - 1, 1), [y, m]);
  const to = useMemo(() => new Date(y, m, 1), [y, m]);
  const revs = useRevenues(t, from); const pays = usePayables(t); const cash = useCashEntries(t, from);
  if (revs.error || pays.error || cash.error) return <Alert>{revs.error || pays.error || cash.error}</Alert>;
  if (!revs.data || !pays.data || !cash.data) return <Spinner />;
  const dre: Dre = regime === "competencia" ? dreCompetencia(revs.data, pays.data, from, to) : dreCaixa(cash.data, from, to);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Mês"><Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></Field>
        <Field label="Regime"><Select value={regime} onChange={(e) => setRegime(e.target.value as typeof regime)}><option value="competencia">Competência (reconhecido no mês)</option><option value="caixa">Caixa (entrou/saiu no mês)</option></Select></Field>
      </div>
      <p className="text-xs text-slate-500">{regime === "competencia" ? "Receita reconhecida no checkout da hospedagem; despesas pela data de competência, pagas ou não." : "Considera apenas dinheiro efetivamente recebido e pago; transferências ficam de fora."}</p>
      {dre.warnings.map((w) => <Alert key={w} kind="info">{w}</Alert>)}
      <Card>
        <Block title="Receitas" rows={dre.revenue} total={dre.revenueCents} />
        <Block title="Despesas" rows={dre.expense} total={dre.expenseCents} />
        <div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-base font-bold"><span>Resultado</span><span className={dre.resultCents >= 0 ? "text-emerald-700" : "text-red-700"}>{formatCents(dre.resultCents)}</span></div>
      </Card>
    </div>
  );
}
function Block({ title, rows, total }: { title: string; rows: { category: string; cents: number }[]; total: number }) {
  return (
    <div className="mb-3">
      <h3 className="flex justify-between font-semibold"><span>{title}</span><span>{formatCents(total)}</span></h3>
      <ul className="mt-1 text-sm text-slate-700">{rows.map((r) => <li key={r.category} className="flex justify-between py-0.5"><span>{r.category}</span><span>{formatCents(r.cents)}</span></li>)}{rows.length === 0 && <li className="text-slate-400">Sem lançamentos</li>}</ul>
    </div>
  );
}
