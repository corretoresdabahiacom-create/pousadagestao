import type { Timestamp } from "firebase/firestore";

export const DAY_MS = 24 * 60 * 60 * 1000;

export function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const t = v as Timestamp;
  return typeof t.toDate === "function" ? t.toDate() : null;
}

export function fmtDateTime(d: Date | null | undefined, tz?: string): string {
  if (!d) return "—";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: tz });
}

export function fmtDate(d: Date | null | undefined, tz?: string): string {
  if (!d) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: tz });
}

/** Valor para <input type="datetime-local"> no horário local do navegador. */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Diárias = períodos de 24 h a partir da entrada (pousada 24h), no mínimo 1. */
export function countNights(checkIn: Date, checkOut: Date): number {
  return Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / DAY_MS));
}

export function addNights(checkIn: Date, nights: number): Date {
  return new Date(checkIn.getTime() + nights * DAY_MS);
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function newId(): string {
  return crypto.randomUUID();
}
