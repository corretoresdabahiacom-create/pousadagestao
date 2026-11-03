export type Role = "owner" | "admin" | "reception" | "finance" | "staff";

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  reception: "Recepção",
  finance: "Financeiro",
  staff: "Funcionário",
};

/** Papéis que podem ser convidados (proprietário só existe na criação da pousada). */
export const INVITABLE_ROLES: Role[] = ["admin", "reception", "finance", "staff"];

export const isManager = (r: Role | undefined) => r === "owner" || r === "admin";

export type RoomStatus =
  | "available"
  | "occupied"
  | "awaiting_cleaning"
  | "cleaning"
  | "maintenance"
  | "blocked";

export const ROOM_STATUS_LABELS: Record<RoomStatus, string> = {
  available: "Disponível",
  occupied: "Ocupado",
  awaiting_cleaning: "Aguardando limpeza",
  cleaning: "Em limpeza",
  maintenance: "Em manutenção",
  blocked: "Bloqueado",
};

export const ROOM_STATUS_STYLES: Record<RoomStatus, string> = {
  available: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  occupied: "bg-sky-50 text-sky-700 ring-sky-600/20",
  awaiting_cleaning: "bg-amber-50 text-amber-800 ring-amber-600/20",
  cleaning: "bg-amber-50 text-amber-800 ring-amber-600/20",
  maintenance: "bg-orange-50 text-orange-700 ring-orange-600/20",
  blocked: "bg-slate-100 text-slate-700 ring-slate-500/20",
};

export const ROOM_CATEGORIES: { id: string; label: string }[] = [
  { id: "individual", label: "Individual" },
  { id: "casal", label: "Casal" },
  { id: "triplo", label: "Triplo" },
  { id: "familia", label: "Família" },
  { id: "suite", label: "Suíte" },
  { id: "chale", label: "Chalé" },
  { id: "outras", label: "Outras" },
];

export interface Room {
  id: string;
  number: string;
  name?: string;
  categoryId: string;
  description?: string;
  capacity: number;
  beds: number;
  dailyRateCents: number;
  extraPersonCents?: number;
  amenities: string[];
  notes?: string;
  status: RoomStatus;
  archived?: boolean;
}

export interface Member {
  uid: string;
  role: Role;
  active: boolean;
  name?: string;
  email?: string;
}

export interface Invite {
  email: string;
  role: Role;
}

export interface TenantInfo {
  id: string;
  name: string;
  displayName?: string;
  status: string;
  planId: string;
  limits?: { maxRooms?: number };
}

/** Limite de quartos quando a pousada ainda não tem limite definido pelo painel master. */
export const DEFAULT_MAX_ROOMS = 10;

export const TIMEZONES: { id: string; label: string }[] = [
  { id: "America/Sao_Paulo", label: "Brasília (UTC−3)" },
  { id: "America/Bahia", label: "Bahia (UTC−3)" },
  { id: "America/Fortaleza", label: "Fortaleza (UTC−3)" },
  { id: "America/Manaus", label: "Manaus (UTC−4)" },
  { id: "America/Cuiaba", label: "Cuiabá (UTC−4)" },
  { id: "America/Rio_Branco", label: "Rio Branco (UTC−5)" },
  { id: "America/Noronha", label: "Fernando de Noronha (UTC−2)" },
];

export const UF_LIST = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA",
  "PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];
