import type { User } from "firebase/auth";
import {
  Timestamp,
  collection,
  deleteField,
  doc,
  runTransaction,
  serverTimestamp,
  type Transaction,
} from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import { countNights, toDate } from "@/lib/format";
import { StayError, computePlanned, type Stay } from "@/lib/stays";
import { conflictMessage, findConflicts, parseSchedule, type Schedule } from "@/lib/schedule";

export { conflictMessage, findConflicts, overlaps, parseSchedule, stayBusy, type Conflict, type Schedule, type ScheduleItem } from "@/lib/schedule";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type ReservationStatus = "confirmed" | "cancelled" | "no_show" | "checked_in";
export type ReservationSource = "direto" | "whatsapp" | "telefone" | "booking" | "airbnb" | "outro";

export const SOURCES: { id: ReservationSource; label: string }[] = [
  { id: "direto", label: "Direto (balcão)" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "telefone", label: "Telefone" },
  { id: "booking", label: "Booking" },
  { id: "airbnb", label: "Airbnb" },
  { id: "outro", label: "Outro" },
];
export const sourceLabel = (s: string) => SOURCES.find((x) => x.id === s)?.label ?? s;

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  confirmed: "Confirmada",
  cancelled: "Cancelada",
  no_show: "Não compareceu",
  checked_in: "Check-in feito",
};

export interface Reservation {
  id: string;
  status: ReservationStatus;
  roomId: string;
  roomNumber: string;
  guestName: string;
  guestPhone: string;
  guestEmail: string;
  guestId: string | null;
  adults: number;
  children: number;
  checkInAt: Date;
  plannedCheckOutAt: Date;
  nights: number;
  dailyRateCents: number;
  lodgingCents: number;
  discountCents: number;
  feesCents: number;
  totalPlannedCents: number;
  source: ReservationSource;
  notes: string;
  stayId?: string;
  cancelReason?: string;
  createdAt: Date | null;
}

export function parseReservation(id: string, x: Record<string, unknown>): Reservation {
  const st = x.status as ReservationStatus;
  return {
    id,
    status: (["confirmed", "cancelled", "no_show", "checked_in"] as const).includes(st) ? st : "confirmed",
    roomId: String(x.roomId ?? ""),
    roomNumber: String(x.roomNumber ?? ""),
    guestName: String(x.guestName ?? ""),
    guestPhone: String(x.guestPhone ?? ""),
    guestEmail: String(x.guestEmail ?? ""),
    guestId: (x.guestId as string | null) ?? null,
    adults: Number(x.adults ?? 1),
    children: Number(x.children ?? 0),
    checkInAt: toDate(x.checkInAt) ?? new Date(0),
    plannedCheckOutAt: toDate(x.plannedCheckOutAt) ?? new Date(0),
    nights: Number(x.nights ?? 1),
    dailyRateCents: Number(x.dailyRateCents ?? 0),
    lodgingCents: Number(x.lodgingCents ?? 0),
    discountCents: Number(x.discountCents ?? 0),
    feesCents: Number(x.feesCents ?? 0),
    totalPlannedCents: Number(x.totalPlannedCents ?? 0),
    source: (x.source as ReservationSource) ?? "outro",
    notes: String(x.notes ?? ""),
    stayId: x.stayId as string | undefined,
    cancelReason: x.cancelReason as string | undefined,
    createdAt: toDate(x.createdAt),
  };
}

// ---------------------------------------------------------------------------
// Gravação (transações)
// ---------------------------------------------------------------------------

export interface ReservationInput {
  roomId: string;
  guestName: string;
  guestPhone: string;
  guestEmail: string;
  guestId: string | null;
  adults: number;
  children: number;
  checkInAt: Date;
  plannedCheckOutAt: Date;
  dailyRateCents: number;
  discountCents: number;
  feesCents: number;
  source: ReservationSource;
  notes: string;
}

function validate(i: ReservationInput) {
  if (!i.guestName.trim()) throw new StayError("Informe o nome do hóspede.");
  if (!i.roomId) throw new StayError("Escolha o quarto.");
  if (!(i.plannedCheckOutAt > i.checkInAt)) throw new StayError("A saída prevista deve ser depois da chegada.");
  for (const n of [i.dailyRateCents, i.discountCents, i.feesCents]) {
    if (!Number.isSafeInteger(n) || n < 0) throw new StayError("Valores inválidos.");
  }
  if (!Number.isInteger(i.adults) || i.adults < 1 || i.adults > 50) throw new StayError("Informe ao menos 1 adulto.");
  if (!Number.isInteger(i.children) || i.children < 0 || i.children > 50) throw new StayError("Número de crianças inválido.");
  const nights = countNights(i.checkInAt, i.plannedCheckOutAt);
  if (nights > 366) throw new StayError("A reserva pode ter no máximo 366 diárias.");
  const { lodging, total } = computePlanned(i.dailyRateCents, nights, i.discountCents, i.feesCents);
  if (i.discountCents > lodging + i.feesCents) throw new StayError("O desconto não pode ser maior que o total.");
  return { nights, lodging, total };
}

/** Remove da agenda os itens que já terminaram há mais de 30 dias (mantém o documento pequeno). */
function pruned(s: Schedule, now: Date): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) if (v.end.getTime() < now.getTime() - 30 * 86400000) out[k] = deleteField();
  return out;
}

/** Lê a agenda e a hospedagem ativa do quarto dentro da transação e recusa se houver choque de datas. */
async function assertFree(tx: Transaction, t: string, roomId: string, start: Date, end: Date, ignore?: string) {
  const { db } = getFirebase();
  const [roomSnap, schedSnap] = await Promise.all([
    tx.get(doc(db, `tenants/${t}/rooms/${roomId}`)),
    tx.get(doc(db, `tenants/${t}/roomSchedules/${roomId}`)),
  ]);
  if (!roomSnap.exists() || roomSnap.data().archived === true) throw new StayError("Quarto não encontrado.");
  const schedule = parseSchedule(schedSnap.data());
  let activeStay: Pick<Stay, "id" | "guestName" | "checkInAt" | "plannedCheckOutAt"> | null = null;
  const cur = roomSnap.data().currentStayId as string | undefined;
  if (roomSnap.data().status === "occupied" && cur) {
    const s = await tx.get(doc(db, `tenants/${t}/stays/${cur}`));
    if (s.exists() && s.data().status === "active") {
      activeStay = {
        id: s.id,
        guestName: String(s.data().guestName ?? ""),
        checkInAt: toDate(s.data().checkInAt) ?? new Date(0),
        plannedCheckOutAt: toDate(s.data().plannedCheckOutAt) ?? new Date(0),
      };
    }
  }
  const c = findConflicts(schedule, start, end, { ignore, activeStay, now: new Date() });
  if (c.length) throw new StayError(conflictMessage(c, (d) => d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })));
  return { roomNumber: String(roomSnap.data().number ?? ""), schedule };
}

function resDoc(i: ReservationInput, roomNumber: string, calc: { nights: number; lodging: number; total: number }) {
  return {
    roomId: i.roomId,
    roomNumber,
    guestName: i.guestName.trim().slice(0, 120),
    guestPhone: i.guestPhone.trim().slice(0, 30),
    guestEmail: i.guestEmail.trim().toLowerCase().slice(0, 120),
    guestId: i.guestId,
    adults: i.adults,
    children: i.children,
    checkInAt: Timestamp.fromDate(i.checkInAt),
    plannedCheckOutAt: Timestamp.fromDate(i.plannedCheckOutAt),
    nights: calc.nights,
    dailyRateCents: i.dailyRateCents,
    lodgingCents: calc.lodging,
    discountCents: i.discountCents,
    feesCents: i.feesCents,
    totalPlannedCents: calc.total,
    source: i.source,
    notes: i.notes.trim().slice(0, 500),
    updatedAt: serverTimestamp(),
  };
}

function scheduleItem(i: ReservationInput) {
  return { start: Timestamp.fromDate(i.checkInAt), end: Timestamp.fromDate(i.plannedCheckOutAt), guestName: i.guestName.trim().slice(0, 120) };
}

export async function createReservation(t: string, user: User, i: ReservationInput): Promise<string> {
  const calc = validate(i);
  const { db } = getFirebase();
  const ref = doc(collection(db, `tenants/${t}/reservations`));
  await runTransaction(db, async (tx) => {
    const { roomNumber, schedule } = await assertFree(tx, t, i.roomId, i.checkInAt, i.plannedCheckOutAt);
    tx.set(ref, { ...resDoc(i, roomNumber, calc), status: "confirmed", createdBy: user.uid, createdAt: serverTimestamp() });
    tx.set(doc(db, `tenants/${t}/roomSchedules/${i.roomId}`), { items: { ...pruned(schedule, new Date()), [ref.id]: scheduleItem(i) }, updatedAt: serverTimestamp() }, { merge: true });
    tx.set(doc(collection(db, `tenants/${t}/auditLogs`)), { actorUid: user.uid, action: "reservation.create", details: { reservationId: ref.id, roomId: i.roomId }, at: serverTimestamp() });
  });
  return ref.id;
}

export async function updateReservation(t: string, user: User, r: Reservation, i: ReservationInput): Promise<void> {
  const calc = validate(i);
  const { db } = getFirebase();
  const ref = doc(db, `tenants/${t}/reservations/${r.id}`);
  await runTransaction(db, async (tx) => {
    const cur = await tx.get(ref);
    if (!cur.exists() || cur.data().status !== "confirmed") throw new StayError("Esta reserva não está mais confirmada.");
    const oldRoom = String(cur.data().roomId);
    const { roomNumber } = await assertFree(tx, t, i.roomId, i.checkInAt, i.plannedCheckOutAt, r.id);
    tx.update(ref, resDoc(i, roomNumber, calc));
    tx.set(doc(db, `tenants/${t}/roomSchedules/${i.roomId}`), { items: { [r.id]: scheduleItem(i) }, updatedAt: serverTimestamp() }, { merge: true });
    if (oldRoom !== i.roomId) {
      tx.set(doc(db, `tenants/${t}/roomSchedules/${oldRoom}`), { items: { [r.id]: deleteField() }, updatedAt: serverTimestamp() }, { merge: true });
    }
    tx.set(doc(collection(db, `tenants/${t}/auditLogs`)), { actorUid: user.uid, action: "reservation.update", details: { reservationId: r.id, roomId: i.roomId }, at: serverTimestamp() });
  });
}

/** Cancela (ou marca "não compareceu") e libera o quarto na agenda. */
export async function cancelReservation(t: string, user: User, r: Reservation, reason: string, noShow = false): Promise<void> {
  const { db } = getFirebase();
  if (noShow && r.checkInAt.getTime() > Date.now()) throw new StayError("Só dá para marcar \"não compareceu\" depois do horário de chegada.");
  const ref = doc(db, `tenants/${t}/reservations/${r.id}`);
  await runTransaction(db, async (tx) => {
    const cur = await tx.get(ref);
    if (!cur.exists() || cur.data().status !== "confirmed") throw new StayError("Esta reserva não está mais confirmada.");
    tx.update(ref, { status: noShow ? "no_show" : "cancelled", cancelReason: reason.trim().slice(0, 300), cancelledBy: user.uid, cancelledAt: serverTimestamp(), updatedAt: serverTimestamp() });
    tx.set(doc(db, `tenants/${t}/roomSchedules/${String(cur.data().roomId)}`), { items: { [r.id]: deleteField() }, updatedAt: serverTimestamp() }, { merge: true });
    tx.set(doc(collection(db, `tenants/${t}/auditLogs`)), { actorUid: user.uid, action: noShow ? "reservation.no_show" : "reservation.cancel", details: { reservationId: r.id }, at: serverTimestamp() });
  });
}
