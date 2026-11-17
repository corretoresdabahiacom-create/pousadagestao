import { DAY_MS } from "@/lib/format";

/** Dados mínimos de uma hospedagem para o cálculo de ocupação. */
export interface OccStay {
  status: "active" | "closed";
  checkInAt: Date;
  plannedCheckOutAt: Date;
  checkedOutAt?: Date | null;
  nights: number;
  lodgingCents: number;
  discountCents: number;
}

export interface OccDay {
  day: Date;
  roomNights: number; // quartos ocupados em média no dia (horas ocupadas ÷ 24)
  occupancy: number; // 0..1
  revenueCents: number; // receita de diárias proporcional ao dia
}

export interface OccReport {
  days: OccDay[];
  rooms: number;
  roomNights: number;
  capacity: number; // quartos × dias
  occupancy: number; // 0..1
  revenueCents: number;
  adrCents: number; // diária média = receita ÷ quarto-diárias vendidas
  revparCents: number; // receita por quarto disponível = receita ÷ capacidade
}

/** Fim efetivo da ocupação: saída real; se ainda ativa, a saída prevista ou agora (o que for maior). */
export function stayEnd(s: OccStay, now: Date): Date {
  if (s.status === "closed" && s.checkedOutAt) return s.checkedOutAt;
  return new Date(Math.max(s.plannedCheckOutAt.getTime(), now.getTime()));
}

/** Valor de uma diária já com desconto (taxas não entram: não são receita de quarto). */
export function effectiveDailyCents(s: OccStay): number {
  const n = Math.max(1, s.nights);
  return Math.max(0, s.lodgingCents - s.discountCents) / n;
}

/**
 * Ocupação por dia de calendário (fuso do navegador) no período [from, to).
 * Pousada 24 h: cada hospedagem conta pelas horas que ocupou em cada dia, então uma diária
 * das 15h às 15h do dia seguinte vale meio quarto em cada um dos dois dias (1 quarto-diária no total).
 * Hospedagens ativas contam até a saída prevista (previsão para os dias futuros).
 */
export function occupancyReport(stays: OccStay[], rooms: number, from: Date, to: Date, now: Date): OccReport {
  const days: OccDay[] = [];
  for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); d < to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const a = Math.max(d.getTime(), from.getTime());
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const b = Math.min(next, to.getTime());
    let ms = 0;
    let rev = 0;
    for (const s of stays) {
      const ov = Math.min(b, stayEnd(s, now).getTime()) - Math.max(a, s.checkInAt.getTime());
      if (ov > 0) {
        ms += ov;
        rev += (ov / DAY_MS) * effectiveDailyCents(s);
      }
    }
    const roomNights = ms / DAY_MS;
    const dayLen = (b - a) / DAY_MS;
    days.push({ day: new Date(d), roomNights, occupancy: rooms > 0 && dayLen > 0 ? roomNights / (rooms * dayLen) : 0, revenueCents: Math.round(rev) });
  }
  const roomNights = days.reduce((x, d) => x + d.roomNights, 0);
  const capacity = rooms * ((to.getTime() - from.getTime()) / DAY_MS);
  const revenueCents = days.reduce((x, d) => x + d.revenueCents, 0);
  return {
    days,
    rooms,
    roomNights,
    capacity,
    occupancy: capacity > 0 ? roomNights / capacity : 0,
    revenueCents,
    adrCents: roomNights > 0 ? Math.round(revenueCents / roomNights) : 0,
    revparCents: capacity > 0 ? Math.round(revenueCents / capacity) : 0,
  };
}
