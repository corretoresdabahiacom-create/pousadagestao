"use client";

import { useMemo, useState } from "react";
import { fmtDate, fmtDateTime } from "@/lib/format";
import {
  ACTIVITY_LABEL, TRIAL_DAYS, activityOf, buildAlerts, buildOverview, roomLimit, tenantLabel, tenantsCsv, trialInfo,
  type Activity, type Stats, type TenantRow,
} from "@/lib/platform";
import { DEFAULT_MAX_ROOMS } from "@/lib/types";
import { download } from "@/lib/exporters";
import { Badge, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";

export interface Plan { id: string; name: string; maxRooms: number }
export type Patch = (t: TenantRow, data: Record<string, unknown>, label: string) => Promise<void>;

const STATUS: Record<string, { l: string; c: string }> = {
  trial: { l: "Teste", c: "bg-sky-50 text-sky-700 ring-sky-600/20" },
  active: { l: "Ativa", c: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  suspended: { l: "Suspensa", c: "bg-red-50 text-red-700 ring-red-600/20" },
  cancelled: { l: "Cancelada", c: "bg-slate-100 text-slate-700 ring-slate-500/20" },
};
const ACT_STYLE: Record<Activity, string> = {
  today: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  week: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  idle: "bg-amber-50 text-amber-800 ring-amber-600/20",
  dormant: "bg-red-50 text-red-700 ring-red-600/20",
  never: "bg-slate-100 text-slate-700 ring-slate-500/20",
};
const LEVEL_STYLE = { alta: "bg-red-50 text-red-700 ring-red-600/20", media: "bg-amber-50 text-amber-800 ring-amber-600/20", info: "bg-sky-50 text-sky-700 ring-sky-600/20" } as const;

function Bars({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2 text-sm">
      {items.map((i) => (
        <li key={i.label}>
          <div className="flex justify-between"><span>{i.label}</span><span className="font-semibold">{i.value}</span></div>
          <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${(i.value / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

export function Overview({ tenants, stats, now, onOpen }: { tenants: TenantRow[]; stats: Record<string, Stats>; now: Date; onOpen: (id: string) => void }) {
  const o = useMemo(() => buildOverview(tenants, stats, now), [tenants, stats, now]);
  const alerts = useMemo(() => buildAlerts(tenants, stats, now), [tenants, stats, now]);
  const byId = useMemo(() => Object.fromEntries(tenants.map((t) => [t.id, t])), [tenants]);
  const kpis: [string, number | string, string?][] = [
    ["Pousadas cadastradas", o.total, `${o.new7} nos últimos 7 dias · ${o.new30} em 30 dias`],
    ["Clientes ativos (pagantes)", o.byStatus.active ?? 0, "status Ativa"],
    ["Em teste", o.byStatus.trial ?? 0, `${TRIAL_DAYS} dias de teste`],
    ["Suspensas / canceladas", `${o.byStatus.suspended ?? 0} / ${o.byStatus.cancelled ?? 0}`],
    ["Usando na semana", o.active7, "com atividade nos últimos 7 dias"],
    ["Paradas há 14+ dias", o.dormant, "risco de abandono"],
    ["Quartos gerenciados", o.totalRooms],
    ["Hospedagens (30 dias)", o.totalStays30d, "somando todas as pousadas"],
  ];
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map(([l, v, h]) => (
          <Card key={l}><p className="text-sm text-slate-600">{l}</p><p className="text-3xl font-bold">{v}</p>{h && <p className="text-xs text-slate-500">{h}</p>}</Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><h2 className="mb-3 font-semibold">Ativação: até onde as pousadas chegam</h2><Bars items={o.funnel} />
          <p className="mt-3 text-xs text-slate-500">Quem para no início do funil precisa de ajuda no começo (cadastro de quartos, primeira hospedagem).</p></Card>
        <Card><h2 className="mb-3 font-semibold">Novos cadastros por mês</h2><Bars items={o.signups} /></Card>
      </div>
      <Card>
        <h2 className="mb-2 font-semibold">Atenção ({alerts.length})</h2>
        {alerts.length === 0 ? <p className="text-sm text-slate-500">Nada pendente.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {alerts.slice(0, 30).map((a, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><Badge className={LEVEL_STYLE[a.level]}>{a.level}</Badge> <strong>{byId[a.tenantId] ? tenantLabel(byId[a.tenantId]) : a.tenantId}</strong> — {a.text}</span>
                <Button variant="ghost" onClick={() => onOpen(a.tenantId)}>Ver</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

type Sort = "recent" | "usage" | "stays" | "name";

export function TenantsPanel(p: {
  tenants: TenantRow[]; stats: Record<string, Stats>; plans: Plan[]; notes: Record<string, string>; now: Date;
  focus: string; onFocus: (id: string) => void; onPatch: Patch; onNote: (t: TenantRow, text: string) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [act, setAct] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    const rows = p.tenants.filter((t) => {
      if (p.focus) return t.id === p.focus;
      if (k && !`${tenantLabel(t)} ${t.name} ${p.stats[t.id]?.city ?? ""}`.toLowerCase().includes(k)) return false;
      if (status && t.status !== status) return false;
      if (act && activityOf(p.stats[t.id], p.now) !== act) return false;
      return true;
    });
    const at = (t: TenantRow) => (p.stats[t.id]?.lastActiveAt ?? p.stats[t.id]?.reportedAt)?.getTime() ?? 0;
    return rows.sort((a, b) =>
      sort === "name" ? tenantLabel(a).localeCompare(tenantLabel(b))
      : sort === "usage" ? at(b) - at(a)
      : sort === "stays" ? (p.stats[b.id]?.stays30d ?? 0) - (p.stats[a.id]?.stays30d ?? 0)
      : (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  }, [p.tenants, p.stats, p.focus, p.now, q, status, act, sort]);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="Buscar"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="nome ou cidade" /></Field>
        <Field label="Situação"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todas</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}</Select></Field>
        <Field label="Uso"><Select value={act} onChange={(e) => setAct(e.target.value)}><option value="">Todos</option>{(Object.keys(ACTIVITY_LABEL) as Activity[]).map((k) => <option key={k} value={k}>{ACTIVITY_LABEL[k]}</option>)}</Select></Field>
        <Field label="Ordenar por"><Select value={sort} onChange={(e) => setSort(e.target.value as Sort)}><option value="recent">Cadastro mais recente</option><option value="usage">Último uso</option><option value="stays">Mais hospedagens (30 dias)</option><option value="name">Nome</option></Select></Field>
        {p.focus && <Button variant="secondary" onClick={() => p.onFocus("")}>Mostrar todas</Button>}
        <Button variant="secondary" onClick={() => download(new Blob(["﻿" + tenantsCsv(p.tenants, p.stats, p.now)], { type: "text/csv;charset=utf-8" }), "pousadas-uso.csv")}>Exportar CSV</Button>
      </div>
      {list.length === 0 ? <p className="text-sm text-slate-500">Nenhuma pousada encontrada.</p> : (
        <ul className="divide-y divide-slate-100">
          {list.map((t) => <TenantItem key={t.id} t={t} s={p.stats[t.id]} note={p.notes[t.id] ?? ""} plans={p.plans} now={p.now} onPatch={p.onPatch} onNote={p.onNote} />)}
        </ul>
      )}
    </Card>
  );
}

function Metric({ l, v }: { l: string; v: number | string }) {
  return <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">{l}</p><p className="font-semibold">{v}</p></div>;
}

function TenantItem({ t, s, note, plans, now, onPatch, onNote }: { t: TenantRow; s?: Stats; note: string; plans: Plan[]; now: Date; onPatch: Patch; onNote: (t: TenantRow, text: string) => Promise<void> }) {
  const [rooms, setRooms] = useState(String(t.maxRooms ?? ""));
  const [text, setText] = useState(note);
  const st = STATUS[t.status] ?? STATUS.trial;
  const a = activityOf(s, now);
  const tr = trialInfo(t, now);
  return (
    <li className="space-y-3 py-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">{tenantLabel(t)}</p>
          <p className="text-xs text-slate-500">{[s?.city && `${s.city}${s.state ? "/" + s.state : ""}`, `criada em ${fmtDate(t.createdAt)}`, `plano ${t.planId}`].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tr && <Badge className={tr.expired ? LEVEL_STYLE.alta : LEVEL_STYLE.info}>{tr.expired ? "Teste vencido" : `Teste: ${tr.daysLeft} dia(s)`}</Badge>}
          <Badge className={ACT_STYLE[a]}>{ACTIVITY_LABEL[a]}</Badge>
          <Badge className={st.c}>{st.l}</Badge>
        </div>
      </div>
      {s ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <Metric l="Quartos" v={`${s.rooms} / ${roomLimit(t)}`} /><Metric l="Equipe" v={s.members} /><Metric l="Hospedados agora" v={s.staysActive} />
          <Metric l="Hospedagens (30 d)" v={s.stays30d} /><Metric l="Hospedagens (total)" v={s.staysTotal} /><Metric l="Reservas em aberto" v={s.reservationsOpen} /><Metric l="Hóspedes cadastrados" v={s.guests} />
        </div>
      ) : <p className="text-xs text-slate-500">Ainda sem dados de uso (a pousada não abriu o painel depois da atualização).</p>}
      <p className="text-xs text-slate-500">Último uso: {fmtDateTime(s?.lastActiveAt ?? s?.reportedAt ?? null) || "—"}</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Plano"><Select value={t.planId} onChange={(e) => { const pl = plans.find((x) => x.id === e.target.value); void onPatch(t, { planId: e.target.value, ...(pl ? { limits: { maxRooms: pl.maxRooms } } : {}) }, `plano alterado para ${e.target.value}`); }}>
          <option value="trial">trial</option>{plans.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select></Field>
        <Field label={`Limite de quartos (padrão ${DEFAULT_MAX_ROOMS})`}><Input type="number" min={1} value={rooms} onChange={(e) => setRooms(e.target.value)} className="w-28" /></Field>
        <Button variant="secondary" onClick={() => { const n = parseInt(rooms); if (n >= 1) void onPatch(t, { limits: { maxRooms: n } }, `limite de quartos = ${n}`); }}>Salvar limite</Button>
        {t.status !== "active" && t.status !== "suspended" && t.status !== "cancelled" && <Button variant="secondary" onClick={() => onPatch(t, { status: "active" }, "ativada")}>Ativar</Button>}
        {t.status === "suspended" ? <Button onClick={() => onPatch(t, { status: "active" }, "reativada")}>Reativar</Button>
          : t.status !== "cancelled" && <Button variant="danger" onClick={() => { if (confirm(`Suspender ${tenantLabel(t)}? A equipe e os hóspedes perdem o acesso até a reativação (os dados são mantidos).`)) void onPatch(t, { status: "suspended" }, "suspensa"); }}>Suspender</Button>}
        {t.status !== "cancelled" && <Button variant="ghost" onClick={() => { if (confirm(`Marcar ${tenantLabel(t)} como CANCELADA? O acesso fica bloqueado. Os dados só são apagados mediante pedido (veja a aba LGPD).`)) void onPatch(t, { status: "cancelled" }, "cancelada"); }}>Cancelar contrato</Button>}
      </div>
      <Field label="Anotação interna (contrato, combinados, suporte). Não escreva dados pessoais de hóspedes.">
        <Textarea rows={2} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      {text !== note && <Button variant="secondary" onClick={() => onNote(t, text)}>Salvar anotação</Button>}
    </li>
  );
}
