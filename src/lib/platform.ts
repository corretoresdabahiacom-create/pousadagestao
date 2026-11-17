import { toDate } from "@/lib/format";
import { DEFAULT_MAX_ROOMS } from "@/lib/types";

/** Duração do período de teste de uma pousada nova (dias corridos a partir do cadastro). */
export const TRIAL_DAYS = 14;
const DAY = 86400000;

export interface TenantRow {
  id: string;
  name: string;
  displayName?: string;
  status: string;
  planId: string;
  maxRooms?: number;
  createdAt: Date | null;
}

/**
 * Uso agregado de uma pousada: somente CONTAGENS, cidade/UF e datas. Não existe nenhum campo
 * com nome, documento, contato ou valor de hóspede (LGPD: minimização dos dados).
 */
export interface Stats {
  rooms: number;
  members: number;
  staysActive: number;
  stays30d: number;
  staysTotal: number;
  reservationsOpen: number;
  guests: number;
  city: string;
  state: string;
  reportedAt: Date | null;
  lastActiveAt: Date | null;
}

export function parseStats(x: Record<string, unknown>): Stats {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
  return {
    rooms: n(x.rooms), members: n(x.members), staysActive: n(x.staysActive), stays30d: n(x.stays30d),
    staysTotal: n(x.staysTotal), reservationsOpen: n(x.reservationsOpen), guests: n(x.guests),
    city: String(x.city ?? ""), state: String(x.state ?? ""),
    reportedAt: toDate(x.reportedAt), lastActiveAt: toDate(x.lastActiveAt),
  };
}

export function parseTenant(id: string, x: Record<string, unknown>): TenantRow {
  const limits = x.limits as { maxRooms?: number } | undefined;
  return {
    id, name: String(x.name ?? ""), displayName: x.displayName as string | undefined,
    status: String(x.status ?? "trial"), planId: String(x.planId ?? "trial"),
    maxRooms: typeof limits?.maxRooms === "number" ? limits.maxRooms : undefined,
    createdAt: toDate(x.createdAt),
  };
}

export const tenantLabel = (t: TenantRow) => t.displayName || t.name || t.id;
export const roomLimit = (t: TenantRow) => t.maxRooms ?? DEFAULT_MAX_ROOMS;

/** Situação do período de teste. Só faz sentido para pousadas em "trial". */
export function trialInfo(t: Pick<TenantRow, "status" | "createdAt">, now: Date) {
  if (t.status !== "trial" || !t.createdAt) return null;
  const left = Math.ceil((t.createdAt.getTime() + TRIAL_DAYS * DAY - now.getTime()) / DAY);
  return { daysLeft: left, expired: left <= 0 };
}

export type Activity = "today" | "week" | "idle" | "dormant" | "never";
export const ACTIVITY_LABEL: Record<Activity, string> = {
  today: "Ativa hoje", week: "Ativa na semana", idle: "Pouco uso", dormant: "Parada", never: "Nunca usou",
};

/** Classifica o uso pela última atividade registrada. */
export function activityOf(s: Stats | undefined, now: Date): Activity {
  const at = s?.lastActiveAt ?? s?.reportedAt;
  if (!at) return "never";
  const days = (now.getTime() - at.getTime()) / DAY;
  if (days < 1) return "today";
  if (days < 7) return "week";
  if (days < 14) return "idle";
  return "dormant";
}

export interface Alert { tenantId: string; level: "alta" | "media" | "info"; text: string }

export function buildAlerts(tenants: TenantRow[], stats: Record<string, Stats>, now: Date): Alert[] {
  const out: Alert[] = [];
  for (const t of tenants) {
    if (t.status === "cancelled") continue;
    const s = stats[t.id];
    const tr = trialInfo(t, now);
    if (tr?.expired) out.push({ tenantId: t.id, level: "alta", text: `Teste vencido há ${Math.abs(tr.daysLeft)} dia(s): contatar ou suspender.` });
    else if (tr && tr.daysLeft <= 3) out.push({ tenantId: t.id, level: "media", text: `Teste termina em ${tr.daysLeft} dia(s).` });
    if (s && s.rooms > roomLimit(t)) out.push({ tenantId: t.id, level: "media", text: `Usa ${s.rooms} quartos; o limite é ${roomLimit(t)}.` });
    if (t.status === "suspended") continue;
    const act = activityOf(s, now);
    const age = t.createdAt ? (now.getTime() - t.createdAt.getTime()) / DAY : 0;
    if (act === "never" && age >= 3) out.push({ tenantId: t.id, level: "media", text: "Cadastrada há mais de 3 dias e ainda sem nenhum uso registrado." });
    if (act === "dormant" && s) out.push({ tenantId: t.id, level: "info", text: "Sem uso há mais de 14 dias (risco de abandono)." });
  }
  const rank = { alta: 0, media: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

export interface Overview {
  total: number;
  byStatus: Record<string, number>;
  new7: number;
  new30: number;
  active7: number;
  dormant: number;
  totalRooms: number;
  totalStays30d: number;
  totalMembers: number;
  funnel: { label: string; value: number }[];
  signups: { label: string; value: number }[];
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function buildOverview(tenants: TenantRow[], stats: Record<string, Stats>, now: Date): Overview {
  const byStatus: Record<string, number> = { trial: 0, active: 0, suspended: 0, cancelled: 0 };
  let new7 = 0, new30 = 0, active7 = 0, dormant = 0, totalRooms = 0, totalStays30d = 0, totalMembers = 0;
  const live = tenants.filter((t) => t.status !== "cancelled");
  for (const t of tenants) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    const age = t.createdAt ? (now.getTime() - t.createdAt.getTime()) / DAY : Infinity;
    if (age <= 7) new7++;
    if (age <= 30) new30++;
  }
  for (const t of live) {
    const s = stats[t.id];
    const a = activityOf(s, now);
    if (a === "today" || a === "week") active7++;
    if (a === "dormant") dormant++;
    if (s) { totalRooms += s.rooms; totalStays30d += s.stays30d; totalMembers += s.members; }
  }
  const has = (f: (s: Stats) => boolean) => live.filter((t) => stats[t.id] && f(stats[t.id])).length;
  const signups: Overview["signups"] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = tenants.filter((t) => t.createdAt && t.createdAt.getFullYear() === d.getFullYear() && t.createdAt.getMonth() === d.getMonth()).length;
    signups.push({ label: MONTHS[d.getMonth()], value });
  }
  return {
    total: tenants.length, byStatus, new7, new30, active7, dormant, totalRooms, totalStays30d, totalMembers,
    funnel: [
      { label: "Cadastraram a pousada", value: live.length },
      { label: "Cadastraram quartos", value: has((s) => s.rooms > 0) },
      { label: "Fizeram hospedagens", value: has((s) => s.staysTotal > 0) },
      { label: "Têm reservas futuras", value: has((s) => s.reservationsOpen > 0) },
      { label: "Convidaram a equipe", value: has((s) => s.members > 1) },
    ],
    signups,
  };
}

/** CSV só com dados cadastrais e de uso agregado (sem dados pessoais de hóspedes). */
export function tenantsCsv(tenants: TenantRow[], stats: Record<string, Stats>, now: Date): string {
  const head = ["pousada", "cidade", "uf", "status", "plano", "limite_quartos", "criada_em", "quartos", "equipe", "hospedagens_30d", "hospedagens_total", "reservas_abertas", "uso"];
  // Aspas duplas e proteção contra "injeção de fórmula" em planilhas (= + - @ no início).
  const q = (v: string | number) => { const t = String(v); return `"${(/^[=+\-@\t\r]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`; };
  const rows = tenants.map((t) => {
    const s = stats[t.id];
    return [tenantLabel(t), s?.city ?? "", s?.state ?? "", t.status, t.planId, roomLimit(t), t.createdAt ? t.createdAt.toISOString().slice(0, 10) : "",
      s?.rooms ?? 0, s?.members ?? 0, s?.stays30d ?? 0, s?.staysTotal ?? 0, s?.reservationsOpen ?? 0, ACTIVITY_LABEL[activityOf(s, now)]].map(q).join(",");
  });
  return [head.join(","), ...rows].join("\n");
}
