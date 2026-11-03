import {
  Timestamp, addDoc, collection, doc, getDocs, onSnapshot, query, serverTimestamp, where, writeBatch, orderBy, type DocumentData,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import { getFirebase } from "@/lib/firebase/client";
import { toDate, newId } from "@/lib/format";
import type { PayMethod } from "@/lib/stays";

export const EXPENSE_CATEGORIES = [
  "Folha e encargos", "Energia", "Água", "Internet e telefone", "Alimentação e insumos", "Lavanderia e enxoval",
  "Limpeza e higiene", "Manutenção", "Impostos e taxas", "Marketing", "Comissões", "Aluguel", "Equipamentos", "Outras despesas",
];
export const MANUAL_IN_CATEGORIES = ["Hospedagem", "Alimentação e bebidas", "Serviços", "Outras receitas"];
export const NO_CATEGORY = "Não classificado";

export interface CashEntry { id: string; kind: "in" | "out"; amountCents: number; method?: string; source?: string; category: string; description: string; at: Date; transfer: boolean; registerId?: string }
export interface Revenue { id: string; kind: string; description: string; date: Date; grossCents: number; deductionsCents: number; lines: { category: string; cents: number }[] }
export interface Payable { id: string; supplier: string; description: string; category: string; amountCents: number; dueDate: Date; competenceDate: Date; status: "open" | "paid" | "cancelled"; paidAt?: Date; method?: string; installment?: string; recurringId?: string; origin?: string }
export interface Receivable { id: string; customerName: string; description: string; amountCents: number; receivedCents: number; dueDate: Date; status: "open" | "received" | "cancelled"; stayId?: string }
export interface Register { id: string; status: "open" | "closed"; openingCents: number; openedAt: Date; closedAt?: Date; countedCents?: number; expectedCents?: number; differenceCents?: number; note?: string }
export interface Recurring { id: string; supplier: string; description: string; category: string; amountCents: number; dayOfMonth: number; active: boolean; lastGeneratedMonth?: string }

const ts = (v: unknown): Date => toDate(v) ?? new Date(0);

export const parseCash = (id: string, d: DocumentData): CashEntry => ({
  id, kind: d.kind === "out" ? "out" : "in", amountCents: Number(d.amountCents ?? 0), method: d.method, source: d.source,
  category: (d.category as string) || NO_CATEGORY, description: (d.description as string) ?? "", at: ts(d.at), transfer: d.transfer === true, registerId: d.registerId,
});
export const parseRevenue = (id: string, d: DocumentData): Revenue => ({
  id, kind: d.kind, description: d.description ?? "", date: ts(d.date), grossCents: Number(d.grossCents ?? 0),
  deductionsCents: Number(d.deductionsCents ?? 0), lines: Array.isArray(d.lines) ? d.lines : [],
});
export const parsePayable = (id: string, d: DocumentData): Payable => ({
  id, supplier: d.supplier ?? "", description: d.description ?? "", category: d.category || NO_CATEGORY, amountCents: Number(d.amountCents ?? 0),
  dueDate: ts(d.dueDate), competenceDate: ts(d.competenceDate ?? d.dueDate), status: d.status ?? "open", paidAt: d.paidAt ? ts(d.paidAt) : undefined,
  method: d.method, installment: d.installment, recurringId: d.recurringId, origin: d.origin,
});
export const parseReceivable = (id: string, d: DocumentData): Receivable => ({
  id, customerName: d.customerName ?? "", description: d.description ?? "", amountCents: Number(d.amountCents ?? 0),
  receivedCents: Number(d.receivedCents ?? 0), dueDate: ts(d.dueDate), status: d.status ?? "open", stayId: d.stayId,
});
export const parseRegister = (id: string, d: DocumentData): Register => ({
  id, status: d.status === "closed" ? "closed" : "open", openingCents: Number(d.openingCents ?? 0), openedAt: ts(d.openedAt),
  closedAt: d.closedAt ? ts(d.closedAt) : undefined, countedCents: d.countedCents, expectedCents: d.expectedCents, differenceCents: d.differenceCents, note: d.note,
});

/** Assina uma coleção financeira em tempo real. `since` limita pelo campo de data (economiza leituras). */
function useColl<T>(tenantId: string | undefined, name: string, parse: (id: string, d: DocumentData) => T, dateField?: string, since?: Date) {
  const [data, setData] = useState<T[] | null>(null);
  const [error, setError] = useState("");
  const sinceMs = since?.getTime();
  useEffect(() => {
    if (!tenantId) return;
    const { db } = getFirebase();
    const col = collection(db, `tenants/${tenantId}/${name}`);
    const q = dateField && sinceMs ? query(col, where(dateField, ">=", Timestamp.fromMillis(sinceMs))) : col;
    return onSnapshot(q, (s) => { setData(s.docs.map((d) => parse(d.id, d.data()))); setError(""); }, () => setError("Sem permissão ou falha ao carregar dados financeiros."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, name, dateField, sinceMs]);
  return { data, error };
}
export const useCashEntries = (t?: string, since?: Date) => useColl(t, "cashEntries", parseCash, "at", since);
export const useRevenues = (t?: string, since?: Date) => useColl(t, "revenues", parseRevenue, "date", since);
export const usePayables = (t?: string) => useColl(t, "accountsPayable", parsePayable);
export const useReceivables = (t?: string) => useColl(t, "accountsReceivable", parseReceivable);
export const useRegisters = (t?: string) => useColl(t, "cashRegisters", parseRegister);
export const useRecurring = (t?: string) => useColl(t, "recurringExpenses", (id, d): Recurring => ({ id, supplier: d.supplier ?? "", description: d.description ?? "", category: d.category ?? NO_CATEGORY, amountCents: Number(d.amountCents ?? 0), dayOfMonth: Number(d.dayOfMonth ?? 1), active: d.active !== false, lastGeneratedMonth: d.lastGeneratedMonth }));

// ---------------------------------------------------------------- caixa
export async function openRegister(t: string, uid: string, openingCents: number) {
  const { db } = getFirebase();
  const ref = doc(collection(db, `tenants/${t}/cashRegisters`));
  const b = writeBatch(db);
  b.set(ref, { status: "open", openingCents, openedBy: uid, openedAt: serverTimestamp() });
  b.set(doc(collection(db, `tenants/${t}/auditLogs`)), { actorUid: uid, action: "cash.open", details: { openingCents }, at: serverTimestamp() });
  await b.commit();
}

/** Saldo esperado em dinheiro físico: abertura + entradas em dinheiro − saídas em dinheiro desde a abertura. */
export function expectedCash(reg: Register, entries: CashEntry[]): number {
  const from = reg.openedAt.getTime();
  const to = reg.closedAt?.getTime() ?? Infinity;
  return entries
    .filter((e) => !e.transfer && e.method === "dinheiro" && e.at.getTime() >= from - 2000 && e.at.getTime() <= to)
    .reduce((s, e) => s + (e.kind === "in" ? e.amountCents : -e.amountCents), reg.openingCents);
}

export async function closeRegister(t: string, uid: string, reg: Register, entries: CashEntry[], countedCents: number, note: string) {
  const { db } = getFirebase();
  const expected = expectedCash(reg, entries);
  const b = writeBatch(db);
  b.update(doc(db, `tenants/${t}/cashRegisters/${reg.id}`), {
    status: "closed", closedAt: serverTimestamp(), closedBy: uid, countedCents, expectedCents: expected, differenceCents: countedCents - expected, note,
  });
  b.set(doc(collection(db, `tenants/${t}/auditLogs`)), { actorUid: uid, action: "cash.close", details: { registerId: reg.id, expected, countedCents, diff: countedCents - expected }, at: serverTimestamp() });
  await b.commit();
}

export async function addManualEntry(t: string, uid: string, e: { kind: "in" | "out"; amountCents: number; method: PayMethod; category: string; description: string; transfer?: boolean; registerId?: string; key: string }) {
  const { db } = getFirebase();
  const b = writeBatch(db);
  b.set(doc(db, `tenants/${t}/cashEntries/manual-${e.key}`), {
    kind: e.kind, amountCents: e.amountCents, method: e.method, source: "manual", category: e.category, description: e.description,
    transfer: e.transfer === true, registerId: e.registerId ?? null, createdBy: uid, at: serverTimestamp(),
  });
  b.set(doc(collection(db, `tenants/${t}/auditLogs`)), { actorUid: uid, action: "cash.manual", details: { kind: e.kind, amountCents: e.amountCents, category: e.category }, at: serverTimestamp() });
  await b.commit();
}

// ------------------------------------------------------- contas a pagar
export interface PayableInput { supplier: string; description: string; category: string; amountCents: number; dueDate: Date; competenceDate: Date; installments: number }

/** Divide em parcelas (centavos exatos; a diferença vai na última). Parcelas futuras ficam em aberto, nunca pagas. */
export function splitInstallments(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const arr = Array<number>(n).fill(base);
  arr[n - 1] += total - base * n;
  return arr;
}
export async function createPayables(t: string, uid: string, i: PayableInput) {
  const { db } = getFirebase();
  const b = writeBatch(db);
  const parts = splitInstallments(i.amountCents, Math.max(1, i.installments));
  const group = newId();
  parts.forEach((cents, idx) => {
    const due = new Date(i.dueDate); due.setMonth(due.getMonth() + idx);
    const comp = new Date(i.competenceDate); comp.setMonth(comp.getMonth() + idx);
    b.set(doc(db, `tenants/${t}/accountsPayable/${group}-${idx + 1}`), {
      supplier: i.supplier, description: i.description, category: i.category, amountCents: cents,
      dueDate: Timestamp.fromDate(due), competenceDate: Timestamp.fromDate(comp), status: "open",
      installment: parts.length > 1 ? `${idx + 1}/${parts.length}` : null, origin: "manual", createdBy: uid, createdAt: serverTimestamp(),
    });
  });
  b.set(doc(collection(db, `tenants/${t}/auditLogs`)), { actorUid: uid, action: "payable.create", details: { total: i.amountCents, installments: parts.length }, at: serverTimestamp() });
  await b.commit();
}
export async function payPayable(t: string, uid: string, p: Payable, method: PayMethod, paidOn: Date) {
  const { db } = getFirebase();
  const b = writeBatch(db);
  b.update(doc(db, `tenants/${t}/accountsPayable/${p.id}`), { status: "paid", paidAt: Timestamp.fromDate(paidOn), method, paidBy: uid });
  b.set(doc(db, `tenants/${t}/cashEntries/pay-${p.id}`), {
    kind: "out", amountCents: p.amountCents, method, source: "payable", payableId: p.id, category: p.category,
    description: `${p.supplier ? p.supplier + " — " : ""}${p.description}`, transfer: false, createdBy: uid, at: Timestamp.fromDate(paidOn),
  });
  b.set(doc(collection(db, `tenants/${t}/auditLogs`)), { actorUid: uid, action: "payable.pay", details: { id: p.id, amountCents: p.amountCents }, at: serverTimestamp() });
  await b.commit();
}
export async function cancelPayable(t: string, uid: string, p: Payable, reason: string) {
  const { db } = getFirebase();
  const b = writeBatch(db);
  b.update(doc(db, `tenants/${t}/accountsPayable/${p.id}`), { status: "cancelled", cancelReason: reason, cancelledBy: uid });
  b.set(doc(collection(db, `tenants/${t}/auditLogs`)), { actorUid: uid, action: "payable.cancel", details: { id: p.id, reason }, at: serverTimestamp() });
  await b.commit();
}

/** Gera as contas do mês a partir das despesas recorrentes (uma só vez por mês; em aberto, nunca pagas automaticamente). */
export async function generateRecurring(t: string, uid: string, list: Recurring[], month: Date): Promise<number> {
  const { db } = getFirebase();
  const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  const b = writeBatch(db);
  let n = 0;
  for (const r of list) {
    if (!r.active || r.lastGeneratedMonth === key) continue;
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const due = new Date(month.getFullYear(), month.getMonth(), Math.min(r.dayOfMonth, last), 12);
    b.set(doc(db, `tenants/${t}/accountsPayable/rec-${r.id}-${key}`), {
      supplier: r.supplier, description: r.description, category: r.category, amountCents: r.amountCents,
      dueDate: Timestamp.fromDate(due), competenceDate: Timestamp.fromDate(new Date(month.getFullYear(), month.getMonth(), 1, 12)),
      status: "open", recurringId: r.id, origin: "recorrente", createdBy: uid, createdAt: serverTimestamp(),
    });
    b.update(doc(db, `tenants/${t}/recurringExpenses/${r.id}`), { lastGeneratedMonth: key });
    n++;
  }
  if (n) await b.commit();
  return n;
}
export async function saveRecurring(t: string, r: Omit<Recurring, "id" | "lastGeneratedMonth">) {
  const { db } = getFirebase();
  await addDoc(collection(db, `tenants/${t}/recurringExpenses`), { ...r, createdAt: serverTimestamp() });
}

// ----------------------------------------------------- contas a receber
export async function receiveReceivable(t: string, uid: string, r: Receivable, amountCents: number, method: PayMethod, key: string) {
  const { db } = getFirebase();
  const newTotal = r.receivedCents + amountCents;
  const b = writeBatch(db);
  b.update(doc(db, `tenants/${t}/accountsReceivable/${r.id}`), { receivedCents: newTotal, status: newTotal >= r.amountCents ? "received" : "open", lastReceivedAt: serverTimestamp() });
  b.set(doc(db, `tenants/${t}/cashEntries/rcv-${r.id}-${key}`), {
    kind: "in", amountCents, method, source: "receivable", receivableId: r.id, stayId: r.stayId ?? null, category: "Hospedagem",
    description: `Recebimento — ${r.customerName}`, transfer: false, createdBy: uid, at: serverTimestamp(),
  });
  b.set(doc(collection(db, `tenants/${t}/auditLogs`)), { actorUid: uid, action: "receivable.receive", details: { id: r.id, amountCents }, at: serverTimestamp() });
  await b.commit();
}

// ----------------------------------------------------------------- DRE
export interface Dre {
  revenue: { category: string; cents: number }[];
  expense: { category: string; cents: number }[];
  revenueCents: number; expenseCents: number; resultCents: number;
  warnings: string[];
}
const inRange = (d: Date, from: Date, to: Date) => d >= from && d < to;
const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
const toList = (m: Map<string, number>) => [...m].map(([category, cents]) => ({ category, cents })).sort((a, b) => b.cents - a.cents);

/** Competência: receita reconhecida no checkout (líquida de descontos) e despesas pela data de competência, pagas ou não. */
export function dreCompetencia(revs: Revenue[], pays: Payable[], from: Date, to: Date): Dre {
  const r = new Map<string, number>(); const e = new Map<string, number>(); const warnings: string[] = [];
  for (const x of revs.filter((v) => inRange(v.date, from, to))) {
    for (const l of x.lines) add(r, l.category || NO_CATEGORY, l.cents);
    if (x.deductionsCents) add(r, "(−) Descontos", -x.deductionsCents);
  }
  for (const p of pays.filter((v) => v.status !== "cancelled" && inRange(v.competenceDate, from, to))) add(e, p.category, p.amountCents);
  if (e.has(NO_CATEGORY)) warnings.push("Existem despesas sem categoria (\"Não classificado\"). Classifique-as para um resultado confiável.");
  if (!r.size && !e.size) warnings.push("Sem dados suficientes no período.");
  const revenueCents = [...r.values()].reduce((a, b) => a + b, 0);
  const expenseCents = [...e.values()].reduce((a, b) => a + b, 0);
  return { revenue: toList(r), expense: toList(e), revenueCents, expenseCents, resultCents: revenueCents - expenseCents, warnings };
}
/** Caixa: dinheiro que de fato entrou e saiu; transferências entre caixas não contam. */
export function dreCaixa(entries: CashEntry[], from: Date, to: Date): Dre {
  const r = new Map<string, number>(); const e = new Map<string, number>(); const warnings: string[] = [];
  for (const x of entries.filter((v) => !v.transfer && inRange(v.at, from, to))) {
    if (x.kind === "in") add(r, x.category, x.amountCents);
    else if (x.source === "stay") add(r, "(−) Estornos", -x.amountCents);
    else add(e, x.category, x.amountCents);
  }
  if (e.has(NO_CATEGORY) || r.has(NO_CATEGORY)) warnings.push("Há lançamentos sem categoria (\"Não classificado\").");
  if (!r.size && !e.size) warnings.push("Sem dados suficientes no período.");
  const revenueCents = [...r.values()].reduce((a, b) => a + b, 0);
  const expenseCents = [...e.values()].reduce((a, b) => a + b, 0);
  return { revenue: toList(r), expense: toList(e), revenueCents, expenseCents, resultCents: revenueCents - expenseCents, warnings };
}

export async function loadAllCash(t: string, from: Date, to: Date): Promise<CashEntry[]> {
  const { db } = getFirebase();
  const s = await getDocs(query(collection(db, `tenants/${t}/cashEntries`), where("at", ">=", Timestamp.fromDate(from)), where("at", "<", Timestamp.fromDate(to)), orderBy("at")));
  return s.docs.map((d) => parseCash(d.id, d.data()));
}
