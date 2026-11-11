import type { User } from "firebase/auth";
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import { DAY_MS, addNights, countNights, toDate } from "@/lib/format";
import { generateToken, sha256Hex } from "@/lib/tokens";

// ---------------------------------------------------------------------------
// Tipos e constantes
// ---------------------------------------------------------------------------

export type PayMethod = "dinheiro" | "pix" | "debito" | "credito" | "transferencia" | "outros";
export const PAY_METHODS: { id: PayMethod; label: string }[] = [
  { id: "dinheiro", label: "Dinheiro" },
  { id: "pix", label: "PIX" },
  { id: "debito", label: "Cartão de débito" },
  { id: "credito", label: "Cartão de crédito" },
  { id: "transferencia", label: "Transferência" },
  { id: "outros", label: "Outras" },
];
export const payLabel = (id: string) => PAY_METHODS.find((m) => m.id === id)?.label ?? id;

export const CHARGE_CATEGORIES = [
  { id: "alimentos", label: "Alimentos" },
  { id: "bebidas", label: "Bebidas" },
  { id: "frigobar", label: "Frigobar" },
  { id: "lavanderia", label: "Lavanderia" },
  { id: "servicos", label: "Serviços extras" },
  { id: "diaria_extra", label: "Diárias adicionais" },
  { id: "produtos", label: "Produtos" },
  { id: "outros", label: "Outros serviços" },
] as const;
export const chargeLabel = (id: string) => CHARGE_CATEGORIES.find((c) => c.id === id)?.label ?? id;

export interface Stay {
  id: string;
  status: "active" | "closed";
  roomId: string;
  roomNumber: string;
  guestId: string;
  guestName: string;
  guestPhone?: string;
  accessHash: string;
  checkInAt: Date;
  plannedCheckOutAt: Date;
  checkedOutAt: Date | null;
  nights: number;
  dailyRateCents: number;
  lodgingCents: number;
  discountCents: number;
  feesCents: number;
  totalPlannedCents: number;
  companionsCount: number;
  closing?: Closing;
}

export interface Closing {
  lodgingCents: number;
  feesCents: number;
  discountCents: number;
  chargesCents: number;
  totalCents: number;
  paidCents: number;
  pendingCents: number;
}

export interface Charge {
  id: string;
  status: "active" | "cancelled";
  description: string;
  category: string;
  quantity: number;
  unitCents: number;
  totalCents: number;
  notes?: string;
  createdAt: Date | null;
  cancelReason?: string;
}

export interface Payment {
  id: string;
  kind: "payment" | "refund";
  amountCents: number;
  method: string;
  note?: string;
  createdAt: Date | null;
}

export interface Companion {
  id: string;
  fullName: string;
  document?: string;
  birthDate?: string;
}

export class StayError extends Error {}

export function parseStay(id: string, x: Record<string, unknown>): Stay {
  return {
    id,
    status: x.status === "closed" ? "closed" : "active",
    roomId: x.roomId as string,
    roomNumber: String(x.roomNumber ?? ""),
    guestId: x.guestId as string,
    guestName: (x.guestName as string) ?? "",
    guestPhone: x.guestPhone as string | undefined,
    accessHash: x.accessHash as string,
    checkInAt: toDate(x.checkInAt) ?? new Date(0),
    plannedCheckOutAt: toDate(x.plannedCheckOutAt) ?? new Date(0),
    checkedOutAt: toDate(x.checkedOutAt),
    nights: Number(x.nights ?? 1),
    dailyRateCents: Number(x.dailyRateCents ?? 0),
    lodgingCents: Number(x.lodgingCents ?? 0),
    discountCents: Number(x.discountCents ?? 0),
    feesCents: Number(x.feesCents ?? 0),
    totalPlannedCents: Number(x.totalPlannedCents ?? 0),
    companionsCount: Number(x.companionsCount ?? 0),
    closing: x.closing as Closing | undefined,
  };
}

export function parseCharge(id: string, x: Record<string, unknown>): Charge {
  return {
    id,
    status: x.status === "cancelled" ? "cancelled" : "active",
    description: (x.description as string) ?? "",
    category: (x.category as string) ?? "outros",
    quantity: Number(x.quantity ?? 1),
    unitCents: Number(x.unitCents ?? 0),
    totalCents: Number(x.totalCents ?? 0),
    notes: x.notes as string | undefined,
    createdAt: toDate(x.createdAt),
    cancelReason: x.cancelReason as string | undefined,
  };
}

export function parsePayment(id: string, x: Record<string, unknown>): Payment {
  return {
    id,
    kind: x.kind === "refund" ? "refund" : "payment",
    amountCents: Number(x.amountCents ?? 0),
    method: (x.method as string) ?? "outros",
    note: x.note as string | undefined,
    createdAt: toDate(x.createdAt),
  };
}

// ---------------------------------------------------------------------------
// Cálculos (centavos inteiros)
// ---------------------------------------------------------------------------

export function computePlanned(rateCents: number, nights: number, discountCents: number, feesCents: number) {
  const lodging = rateCents * nights;
  const total = Math.max(0, lodging - discountCents + feesCents);
  return { lodging, total };
}

export interface Account {
  lodgingCents: number;
  feesCents: number;
  discountCents: number;
  chargesCents: number;
  totalCents: number;
  paidCents: number;
  pendingCents: number;
}

/** Conta atual da hospedagem: lançado (hospedagem + consumos − descontos), recebido e saldo. */
export function computeAccount(stay: Stay, charges: Charge[], payments: Payment[]): Account {
  const chargesCents = charges.filter((c) => c.status === "active").reduce((s, c) => s + c.totalCents, 0);
  const totalCents = Math.max(0, stay.lodgingCents + stay.feesCents + chargesCents - stay.discountCents);
  const paidCents = payments.reduce((s, p) => s + (p.kind === "payment" ? p.amountCents : -p.amountCents), 0);
  return {
    lodgingCents: stay.lodgingCents,
    feesCents: stay.feesCents,
    discountCents: stay.discountCents,
    chargesCents,
    totalCents,
    paidCents,
    pendingCents: totalCents - paidCents,
  };
}

// ---------------------------------------------------------------------------
// Auditoria dentro de lotes/transações
// ---------------------------------------------------------------------------

function auditData(uid: string, action: string, details: Record<string, unknown>) {
  return { actorUid: uid, action, details, at: serverTimestamp() };
}

function newAuditRef(t: string) {
  const { db } = getFirebase();
  return doc(collection(db, `tenants/${t}/auditLogs`));
}

function paymentWrites(
  t: string,
  uid: string,
  stayId: string,
  stayLabel: string,
  key: string,
  p: { amountCents: number; method: PayMethod; kind: "payment" | "refund"; note?: string },
) {
  const { db } = getFirebase();
  return [
    {
      ref: doc(db, `tenants/${t}/stays/${stayId}/payments/${key}`),
      data: {
        kind: p.kind,
        amountCents: p.amountCents,
        method: p.method,
        note: p.note ?? "",
        createdBy: uid,
        createdAt: serverTimestamp(),
      },
    },
    {
      ref: doc(db, `tenants/${t}/cashEntries/stay-${key}`),
      data: {
        kind: p.kind === "payment" ? "in" : "out",
        amountCents: p.amountCents,
        method: p.method,
        source: "stay",
        stayId,
        category: "Hospedagem",
        description: `${p.kind === "payment" ? "Recebimento" : "Estorno"} — ${stayLabel}`,
        createdBy: uid,
        at: serverTimestamp(),
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Check-in
// ---------------------------------------------------------------------------

export interface GuestData {
  fullName: string;
  phone: string;
  whatsapp: string;
  email: string;
  document: string;
  birthDate: string;
  emergencyName: string;
  emergencyPhone: string;
  emergencyRelation: string;
  notes: string;
}

export interface NewStayInput {
  tenantId: string;
  user: User;
  guestId?: string;
  guest: GuestData;
  companions: { fullName: string; document: string; birthDate: string }[];
  roomId: string;
  checkInAt: Date;
  plannedCheckOutAt: Date;
  dailyRateCents: number;
  discountCents: number;
  feesCents: number;
  notes: string;
  payment?: { amountCents: number; method: PayMethod };
}

export function guestDoc(g: GuestData) {
  return {
    fullName: g.fullName.trim(),
    nameLower: g.fullName.trim().toLowerCase(),
    phone: g.phone.trim(),
    whatsapp: g.whatsapp.trim(),
    email: g.email.trim().toLowerCase(),
    document: g.document.trim(),
    birthDate: g.birthDate,
    emergency: { name: g.emergencyName.trim(), phone: g.emergencyPhone.trim(), relation: g.emergencyRelation.trim() },
    notes: g.notes.trim(),
    updatedAt: serverTimestamp(),
  };
}

/**
 * Check-in em uma transação: confere o quarto, cria hóspede (se novo), hospedagem, acompanhantes,
 * acesso do QR Code (só o hash), pagamento inicial e auditoria. Se o quarto deixou de estar
 * disponível entre a tela e a confirmação, nada é gravado.
 */
export async function createStay(i: NewStayInput): Promise<{ stayId: string; token: string }> {
  const { db } = getFirebase();
  const t = i.tenantId;
  const uid = i.user.uid;

  if (!i.guest.fullName.trim()) throw new StayError("Informe o nome do responsável.");
  if (i.plannedCheckOutAt <= i.checkInAt) throw new StayError("A saída prevista deve ser depois da entrada.");
  for (const n of [i.dailyRateCents, i.discountCents, i.feesCents]) {
    if (!Number.isSafeInteger(n) || n < 0) throw new StayError("Valores inválidos.");
  }
  const nights = countNights(i.checkInAt, i.plannedCheckOutAt);
  const { lodging, total } = computePlanned(i.dailyRateCents, nights, i.discountCents, i.feesCents);
  if (i.discountCents > lodging + i.feesCents) throw new StayError("O desconto não pode ser maior que o total.");
  const pay = i.payment && i.payment.amountCents > 0 ? i.payment : undefined;
  if (pay && pay.amountCents > total) throw new StayError("O pagamento inicial é maior que o total previsto.");

  const token = generateToken();
  const hash = await sha256Hex(token);

  const stayRef = doc(collection(db, `tenants/${t}/stays`));
  const stayId = stayRef.id;
  const guestRef = i.guestId ? doc(db, `tenants/${t}/guests/${i.guestId}`) : doc(collection(db, `tenants/${t}/guests`));
  const roomRef = doc(db, `tenants/${t}/rooms/${i.roomId}`);

  await runTransaction(db, async (tx) => {
    const room = await tx.get(roomRef);
    const r = room.data();
    if (!room.exists() || r?.archived === true || r?.status !== "available") {
      throw new StayError("Este quarto não está disponível para novo check-in.");
    }

    tx.set(guestRef, i.guestId ? guestDoc(i.guest) : { ...guestDoc(i.guest), createdBy: uid, createdAt: serverTimestamp() }, { merge: true });

    tx.set(stayRef, {
      status: "active",
      roomId: i.roomId,
      roomNumber: String(r?.number ?? ""),
      guestId: guestRef.id,
      guestName: i.guest.fullName.trim(),
      guestPhone: (i.guest.whatsapp || i.guest.phone).trim(),
      accessHash: hash,
      checkInAt: Timestamp.fromDate(i.checkInAt),
      plannedCheckOutAt: Timestamp.fromDate(i.plannedCheckOutAt),
      nights,
      dailyRateCents: i.dailyRateCents,
      lodgingCents: lodging,
      discountCents: i.discountCents,
      feesCents: i.feesCents,
      totalPlannedCents: total,
      companionsCount: i.companions.length,
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Observações internas ficam fora do documento da hospedagem: o hóspede lê a hospedagem, nunca isto.
    if (i.notes.trim()) {
      tx.set(doc(db, `tenants/${t}/stayNotes/${stayId}`), { text: i.notes.trim().slice(0, 500), createdBy: uid, createdAt: serverTimestamp() });
    }

    tx.set(doc(db, `tenants/${t}/stayAccess/${hash}`), {
      stayId,
      status: "active",
      createdBy: uid,
      createdAt: serverTimestamp(),
    });

    tx.update(roomRef, { status: "occupied", currentStayId: stayId, updatedAt: serverTimestamp() });

    for (const c of i.companions) {
      tx.set(doc(collection(db, `tenants/${t}/stays/${stayId}/companions`)), {
        fullName: c.fullName.trim(),
        document: c.document.trim(),
        birthDate: c.birthDate,
        createdAt: serverTimestamp(),
      });
    }

    if (pay) {
      for (const w of paymentWrites(t, uid, stayId, `Quarto ${r?.number}`, `init-${stayId}`, { ...pay, kind: "payment", note: "Pagamento no check-in" })) {
        tx.set(w.ref, w.data);
      }
    }

    tx.set(newAuditRef(t), auditData(uid, "stay.checkin", { stayId, roomId: i.roomId }));
  });

  return { stayId, token };
}

// ---------------------------------------------------------------------------
// Durante a hospedagem
// ---------------------------------------------------------------------------

export async function addCharge(
  t: string,
  user: User,
  stayId: string,
  c: { description: string; category: string; quantity: number; unitCents: number; notes: string },
  key: string,
): Promise<void> {
  const { db } = getFirebase();
  if (!c.description.trim()) throw new StayError("Informe a descrição.");
  if (!Number.isInteger(c.quantity) || c.quantity < 1) throw new StayError("Quantidade inválida.");
  if (!Number.isSafeInteger(c.unitCents) || c.unitCents < 0) throw new StayError("Valor inválido.");
  const ref = doc(db, `tenants/${t}/stays/${stayId}/charges/${key}`);
  const b = writeBatch(db);
  b.set(ref, {
    status: "active",
    description: c.description.trim(),
    category: c.category,
    quantity: c.quantity,
    unitCents: c.unitCents,
    totalCents: c.quantity * c.unitCents,
    notes: c.notes.trim(),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
  });
  b.set(newAuditRef(t), auditData(user.uid, "charge.add", { stayId, chargeId: key }));
  await b.commit();
}

export async function cancelCharge(t: string, user: User, stayId: string, chargeId: string, reason: string): Promise<void> {
  const { db } = getFirebase();
  if (!reason.trim()) throw new StayError("Informe a justificativa do cancelamento.");
  const b = writeBatch(db);
  b.update(doc(db, `tenants/${t}/stays/${stayId}/charges/${chargeId}`), {
    status: "cancelled",
    cancelReason: reason.trim(),
    cancelledBy: user.uid,
    cancelledAt: serverTimestamp(),
  });
  b.set(newAuditRef(t), auditData(user.uid, "charge.cancel", { stayId, chargeId, reason: reason.trim() }));
  await b.commit();
}

/**
 * Registra pagamento (ou estorno) na hospedagem e no caixa, de forma atômica.
 * O ID é a chave de idempotência: repetir após falha de conexão não duplica.
 */
export async function addPayment(
  t: string,
  user: User,
  stay: Stay,
  p: { amountCents: number; method: PayMethod; kind: "payment" | "refund"; note: string },
  key: string,
): Promise<void> {
  const { db } = getFirebase();
  if (!Number.isSafeInteger(p.amountCents) || p.amountCents <= 0) throw new StayError("Valor inválido.");
  const existing = await getDoc(doc(db, `tenants/${t}/stays/${stay.id}/payments/${key}`));
  if (existing.exists()) return; // já gravado numa tentativa anterior
  const b = writeBatch(db);
  for (const w of paymentWrites(t, user.uid, stay.id, `Quarto ${stay.roomNumber} · ${stay.guestName}`, key, p)) b.set(w.ref, w.data);
  b.set(newAuditRef(t), auditData(user.uid, p.kind === "payment" ? "payment.add" : "payment.refund", { stayId: stay.id, amountCents: p.amountCents, key }));
  await b.commit();
}

/** Prorrogação: novo checkout previsto, recálculo das diárias e do total. */
export async function extendStay(t: string, user: User, stay: Stay, newCheckOut: Date): Promise<void> {
  const { db } = getFirebase();
  if (newCheckOut <= stay.checkInAt) throw new StayError("A saída deve ser depois da entrada.");
  const nights = countNights(stay.checkInAt, newCheckOut);
  const { lodging, total } = computePlanned(stay.dailyRateCents, nights, stay.discountCents, stay.feesCents);
  const b = writeBatch(db);
  b.update(doc(db, `tenants/${t}/stays/${stay.id}`), {
    plannedCheckOutAt: Timestamp.fromDate(newCheckOut),
    nights,
    lodgingCents: lodging,
    totalPlannedCents: total,
    updatedAt: serverTimestamp(),
  });
  b.set(
    newAuditRef(t),
    auditData(user.uid, "stay.extend", {
      stayId: stay.id,
      from: stay.plannedCheckOutAt.toISOString(),
      to: newCheckOut.toISOString(),
      nights,
    }),
  );
  await b.commit();
}

/** Revogação manual do QR Code. A hospedagem continua ativa, mas o portal deixa de abrir. */
export async function revokeAccess(t: string, user: User, stay: Stay): Promise<void> {
  const { db } = getFirebase();
  const b = writeBatch(db);
  b.update(doc(db, `tenants/${t}/stayAccess/${stay.accessHash}`), {
    status: "revoked",
    revokedAt: serverTimestamp(),
    revokedBy: user.uid,
    revokedReason: "manual",
  });
  b.set(newAuditRef(t), auditData(user.uid, "access.revoke", { stayId: stay.id }));
  await b.commit();
}

/** Reemissão: revoga o código atual (se ainda ativo) e cria outro para a mesma hospedagem. */
export async function reissueAccess(t: string, user: User, stay: Stay): Promise<string> {
  const { db } = getFirebase();
  const token = generateToken();
  const hash = await sha256Hex(token);
  const oldRef = doc(db, `tenants/${t}/stayAccess/${stay.accessHash}`);
  const old = await getDoc(oldRef);
  const b = writeBatch(db);
  if (old.exists() && old.data().status === "active") {
    b.update(oldRef, { status: "revoked", revokedAt: serverTimestamp(), revokedBy: user.uid, revokedReason: "reissue" });
  }
  b.set(doc(db, `tenants/${t}/stayAccess/${hash}`), { stayId: stay.id, status: "active", createdBy: user.uid, createdAt: serverTimestamp() });
  b.update(doc(db, `tenants/${t}/stays/${stay.id}`), { accessHash: hash, updatedAt: serverTimestamp() });
  b.set(newAuditRef(t), auditData(user.uid, "access.reissue", { stayId: stay.id }));
  await b.commit();
  return token;
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export interface CheckoutInput {
  tenantId: string;
  user: User;
  stay: Stay;
  payment?: { amountCents: number; method: PayMethod; key: string };
  receivableDueDate?: Date;
}

/**
 * Encerra a hospedagem num único lote (tudo ou nada): fecha a conta, revoga o QR Code,
 * registra receita (competência) e pagamento (caixa), cria conta a receber do saldo,
 * coloca o quarto em limpeza e grava auditoria. IDs determinísticos impedem duplicidade.
 */
export async function closeStay(i: CheckoutInput): Promise<Closing> {
  const { db } = getFirebase();
  const t = i.tenantId;
  const uid = i.user.uid;
  const s = i.stay;

  const [chSnap, paySnap, accSnap] = await Promise.all([
    getDocs(collection(db, `tenants/${t}/stays/${s.id}/charges`)),
    getDocs(collection(db, `tenants/${t}/stays/${s.id}/payments`)),
    getDoc(doc(db, `tenants/${t}/stayAccess/${s.accessHash}`)),
  ]);
  const charges = chSnap.docs.map((d) => parseCharge(d.id, d.data()));
  const payments = paySnap.docs.map((d) => parsePayment(d.id, d.data()));
  const acc = computeAccount(s, charges, payments);

  const payNow = i.payment?.amountCents ?? 0;
  if (!Number.isSafeInteger(payNow) || payNow < 0) throw new StayError("Valor de pagamento inválido.");
  const pending = acc.totalCents - acc.paidCents - payNow;
  if (pending < 0) throw new StayError("O pagamento é maior que o saldo da conta.");
  if (pending > 0 && !i.receivableDueDate) throw new StayError("Informe o vencimento do saldo pendente (conta a receber).");

  // Linhas de receita por categoria (competência).
  const lines: { category: string; cents: number }[] = [];
  const add = (category: string, cents: number) => {
    if (cents <= 0) return;
    const l = lines.find((x) => x.category === category);
    if (l) l.cents += cents;
    else lines.push({ category, cents });
  };
  add("hospedagem", s.lodgingCents);
  add("taxas", s.feesCents);
  for (const c of charges) if (c.status === "active") add(c.category, c.totalCents);

  const closing: Closing = {
    lodgingCents: s.lodgingCents,
    feesCents: s.feesCents,
    discountCents: s.discountCents,
    chargesCents: acc.chargesCents,
    totalCents: acc.totalCents,
    paidCents: acc.paidCents + payNow,
    pendingCents: pending,
  };

  const b = writeBatch(db);
  const label = `Quarto ${s.roomNumber} · ${s.guestName}`;

  if (payNow > 0 && i.payment) {
    for (const w of paymentWrites(t, uid, s.id, label, i.payment.key, { amountCents: payNow, method: i.payment.method, kind: "payment", note: "Pagamento no checkout" })) {
      b.set(w.ref, w.data);
    }
  }

  b.set(doc(db, `tenants/${t}/revenues/checkout-${s.id}`), {
    kind: "stay_closing",
    stayId: s.id,
    description: label,
    date: serverTimestamp(),
    grossCents: lines.reduce((x, l) => x + l.cents, 0),
    deductionsCents: s.discountCents,
    lines,
    createdBy: uid,
  });

  if (pending > 0 && i.receivableDueDate) {
    b.set(doc(db, `tenants/${t}/accountsReceivable/stay-${s.id}`), {
      customerName: s.guestName,
      description: `Saldo da hospedagem — ${label}`,
      amountCents: pending,
      receivedCents: 0,
      dueDate: Timestamp.fromDate(i.receivableDueDate),
      status: "open",
      origin: "hospedagem",
      stayId: s.id,
      createdBy: uid,
      createdAt: serverTimestamp(),
    });
  }

  b.set(doc(db, `tenants/${t}/cleaningTasks/clean-${s.id}`), {
    roomId: s.roomId,
    roomNumber: s.roomNumber,
    stayId: s.id,
    status: "pending",
    createdBy: uid,
    createdAt: serverTimestamp(),
  });

  if (accSnap.exists() && accSnap.data().status === "active") {
    b.update(doc(db, `tenants/${t}/stayAccess/${s.accessHash}`), {
      status: "revoked",
      revokedAt: serverTimestamp(),
      revokedBy: uid,
      revokedReason: "checkout",
    });
  }

  b.update(doc(db, `tenants/${t}/rooms/${s.roomId}`), {
    status: "awaiting_cleaning",
    currentStayId: null,
    updatedAt: serverTimestamp(),
  });

  b.update(doc(db, `tenants/${t}/stays/${s.id}`), {
    status: "closed",
    checkedOutAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    closing,
  });

  b.set(newAuditRef(t), auditData(uid, "stay.checkout", { stayId: s.id, totalCents: closing.totalCents, pendingCents: pending }));

  await b.commit();
  return closing;
}

/** Previsão de avisos de saída (2 h e 30 min antes), no horário real da pousada. */
export function reminderTimes(plannedCheckOut: Date): { label: string; at: Date }[] {
  return [
    { label: "2 horas antes", at: new Date(plannedCheckOut.getTime() - 2 * 60 * 60 * 1000) },
    { label: "30 minutos antes", at: new Date(plannedCheckOut.getTime() - 30 * 60 * 1000) },
  ];
}

export { DAY_MS, addNights };
