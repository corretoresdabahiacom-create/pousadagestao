import type { DocumentData } from "firebase/firestore";
import { toDate } from "@/lib/format";
import type { Stay } from "@/lib/stays";

// Agenda de cada quarto e detecção de choque de datas (funções puras, sem acesso ao banco).

/** Item da agenda do quarto (roomSchedules/{roomId}.items[reservationId]). */
export interface ScheduleItem {
  start: Date;
  end: Date;
  guestName: string;
}
export type Schedule = Record<string, ScheduleItem>;

export function parseSchedule(x: DocumentData | undefined): Schedule {
  const items = (x?.items ?? {}) as Record<string, { start?: unknown; end?: unknown; guestName?: unknown }>;
  const out: Schedule = {};
  for (const [k, v] of Object.entries(items)) {
    const start = toDate(v?.start);
    const end = toDate(v?.end);
    if (start && end) out[k] = { start, end, guestName: String(v?.guestName ?? "") };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Conflitos (funções puras, testadas)
// ---------------------------------------------------------------------------

/** Intervalos [a1, a2) e [b1, b2) se sobrepõem? Saída às 15h e entrada às 15h não conflitam. */
export function overlaps(a1: Date, a2: Date, b1: Date, b2: Date): boolean {
  return a1.getTime() < b2.getTime() && b1.getTime() < a2.getTime();
}

/** Período ocupado por uma hospedagem ativa: da entrada até a saída prevista (ou agora, se já passou). */
export function stayBusy(s: Pick<Stay, "checkInAt" | "plannedCheckOutAt">, now: Date): { start: Date; end: Date } {
  return { start: s.checkInAt, end: new Date(Math.max(s.plannedCheckOutAt.getTime(), now.getTime())) };
}

export interface Conflict {
  kind: "reservation" | "stay";
  id: string;
  guestName: string;
  start: Date;
  end: Date;
}

/** Tudo o que colide com [start, end) no quarto: reservas da agenda (menos a ignorada) e a hospedagem ativa. */
export function findConflicts(
  schedule: Schedule,
  start: Date,
  end: Date,
  opts: { ignore?: string; activeStay?: Pick<Stay, "id" | "guestName" | "checkInAt" | "plannedCheckOutAt"> | null; now?: Date } = {},
): Conflict[] {
  const out: Conflict[] = [];
  for (const [id, it] of Object.entries(schedule)) {
    if (id === opts.ignore) continue;
    if (overlaps(start, end, it.start, it.end)) out.push({ kind: "reservation", id, guestName: it.guestName, start: it.start, end: it.end });
  }
  if (opts.activeStay) {
    const b = stayBusy(opts.activeStay, opts.now ?? new Date());
    if (overlaps(start, end, b.start, b.end)) out.push({ kind: "stay", id: opts.activeStay.id, guestName: opts.activeStay.guestName, ...b });
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function conflictMessage(c: Conflict[], fmt: (d: Date) => string): string {
  const x = c[0];
  if (!x) return "";
  const what = x.kind === "stay" ? "hospedado(a)" : "reservado para";
  return `Quarto indisponível: ${what} ${x.guestName || "outro hóspede"} de ${fmt(x.start)} a ${fmt(x.end)}.`;
}
