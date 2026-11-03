"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import { friendlyError, useAuth } from "@/lib/auth/AuthProvider";
import { DEFAULT_MAX_ROOMS } from "@/lib/types";
import { fmtDate, toDate } from "@/lib/format";
import { Alert, Badge, Button, Card, Field, Input, Select, Spinner } from "@/components/ui";

interface TenantRow { id: string; name: string; displayName?: string; status: string; planId: string; maxRooms?: number; createdAt: Date | null }
interface Plan { id: string; name: string; maxRooms: number }
const STATUS: Record<string, { l: string; c: string }> = {
  trial: { l: "Teste", c: "bg-sky-50 text-sky-700 ring-sky-600/20" },
  active: { l: "Ativa", c: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  suspended: { l: "Suspensa", c: "bg-red-50 text-red-700 ring-red-600/20" },
  cancelled: { l: "Cancelada", c: "bg-slate-100 text-slate-700 ring-slate-500/20" },
};

// Painel do dono da plataforma. O acesso é decidido pelas Rules: só quem tem o documento
// platformAdmins/{uid}, criado manualmente no console do Firebase, lê e altera estes dados.
export default function MasterPage() {
  const router = useRouter();
  const { loading, user, logout } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [tenants, setTenants] = useState<TenantRow[] | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");

  useEffect(() => { if (!loading && !user) router.replace("/login/?next=/master/"); }, [loading, user, router]);

  const load = useCallback(async () => {
    const { db } = getFirebase();
    const [t, p] = await Promise.all([getDocs(collection(db, "tenants")), getDocs(collection(db, "platform"))]);
    setTenants(t.docs.map((d) => { const x = d.data(); return { id: d.id, name: x.name ?? "", displayName: x.displayName, status: x.status ?? "trial", planId: x.planId ?? "trial", maxRooms: x.limits?.maxRooms, createdAt: toDate(x.createdAt) }; }).sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)));
    setPlans(p.docs.filter((d) => d.data().type === "plan").map((d) => ({ id: d.id, name: d.data().name ?? d.id, maxRooms: Number(d.data().maxRooms ?? DEFAULT_MAX_ROOMS) })));
  }, []);

  useEffect(() => {
    if (!user) return;
    const { db } = getFirebase();
    getDoc(doc(db, `platformAdmins/${user.uid}`)).then((s) => setIsAdmin(s.exists()), () => setIsAdmin(false));
  }, [user]);
  useEffect(() => { if (isAdmin) void Promise.resolve().then(load).catch((e) => setErr(friendlyError(e))); }, [isAdmin, load]);

  if (loading || !user || isAdmin === null) return <Spinner />;
  if (!isAdmin) return <main className="mx-auto max-w-md p-8"><Alert>Esta área é restrita ao administrador da plataforma.</Alert></main>;

  async function patch(t: TenantRow, data: Record<string, unknown>, label: string) {
    setErr(""); setMsg("");
    try {
      const { db } = getFirebase();
      await updateDoc(doc(db, `tenants/${t.id}`), data);
      await addDoc(collection(db, "platform"), { type: "log", action: label, tenantId: t.id, by: user!.uid, at: serverTimestamp() });
      setMsg(`${t.displayName || t.name}: ${label}.`);
      await load();
    } catch (e) { setErr(friendlyError(e)); }
  }
  const totals = { all: tenants?.length ?? 0, active: tenants?.filter((t) => t.status === "active").length ?? 0, trial: tenants?.filter((t) => t.status === "trial").length ?? 0, susp: tenants?.filter((t) => t.status === "suspended").length ?? 0 };

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-8">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">Painel da plataforma</h1><Button variant="secondary" onClick={logout}>Sair</Button></div>
      {err && <Alert>{err}</Alert>}{msg && <Alert kind="success">{msg}</Alert>}
      <div className="grid gap-3 sm:grid-cols-4">
        {[["Pousadas", totals.all], ["Ativas", totals.active], ["Em teste", totals.trial], ["Suspensas", totals.susp]].map(([l, v]) => <Card key={l as string}><p className="text-sm text-slate-600">{l}</p><p className="text-3xl font-bold">{v}</p></Card>)}
      </div>
      <p className="text-xs text-slate-500">Este painel mostra apenas dados cadastrais das pousadas. Dados de hóspedes e financeiro não são exibidos aqui.</p>

      <Plans plans={plans} onSaved={() => load().catch(() => {})} onError={setErr} />

      <Card>
        <h2 className="mb-2 font-semibold">Pousadas</h2>
        {!tenants ? <Spinner /> : tenants.length === 0 ? <p className="text-sm text-slate-500">Nenhuma pousada cadastrada.</p> : (
          <ul className="divide-y divide-slate-100">
            {tenants.map((t) => <TenantItem key={t.id} t={t} plans={plans} onPatch={patch} />)}
          </ul>
        )}
      </Card>
    </main>
  );
}

function TenantItem({ t, plans, onPatch }: { t: TenantRow; plans: Plan[]; onPatch: (t: TenantRow, d: Record<string, unknown>, label: string) => Promise<void> }) {
  const [rooms, setRooms] = useState(String(t.maxRooms ?? ""));
  const st = STATUS[t.status] ?? STATUS.trial;
  return (
    <li className="space-y-2 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="font-semibold">{t.displayName || t.name}</p><p className="text-xs text-slate-500">{t.name} · criada em {fmtDate(t.createdAt)} · plano {t.planId}</p></div>
        <Badge className={st.c}>{st.l}</Badge>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Plano"><Select value={t.planId} onChange={(e) => { const pl = plans.find((p) => p.id === e.target.value); void onPatch(t, { planId: e.target.value, ...(pl ? { limits: { maxRooms: pl.maxRooms } } : {}) }, `plano alterado para ${e.target.value}`); }}>
          <option value="trial">trial</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select></Field>
        <Field label={`Limite de quartos (padrão ${DEFAULT_MAX_ROOMS})`}><Input type="number" min={1} value={rooms} onChange={(e) => setRooms(e.target.value)} className="w-28" /></Field>
        <Button variant="secondary" onClick={() => { const n = parseInt(rooms); if (n >= 1) void onPatch(t, { limits: { maxRooms: n } }, `limite de quartos = ${n}`); }}>Salvar limite</Button>
        {t.status !== "active" && t.status !== "suspended" && <Button variant="secondary" onClick={() => onPatch(t, { status: "active" }, "ativada")}>Ativar</Button>}
        {t.status === "suspended" ? <Button onClick={() => onPatch(t, { status: "active" }, "reativada")}>Reativar</Button>
          : <Button variant="danger" onClick={() => { if (confirm(`Suspender ${t.displayName || t.name}? A equipe e os hóspedes perdem o acesso até a reativação (os dados são mantidos).`)) void onPatch(t, { status: "suspended" }, "suspensa"); }}>Suspender</Button>}
      </div>
    </li>
  );
}

function Plans({ plans, onSaved, onError }: { plans: Plan[]; onSaved: () => void; onError: (m: string) => void }) {
  const [id, setId] = useState(""); const [name, setName] = useState(""); const [max, setMax] = useState("20");
  async function save() {
    const slug = id.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    const n = parseInt(max);
    if (!slug || !name.trim() || !(n >= 1)) return onError("Informe um código (letras minúsculas), um nome e o limite de quartos.");
    try { const { db } = getFirebase(); await setDoc(doc(db, `platform/plan-${slug}`), { type: "plan", name: name.trim(), maxRooms: n }); setId(""); setName(""); onSaved(); } catch (e) { onError(friendlyError(e)); }
  }
  return (
    <Card>
      <h2 className="mb-2 font-semibold">Planos</h2>
      {plans.length === 0 ? <p className="mb-3 text-sm text-slate-500">Nenhum plano criado. Sem plano, cada pousada usa o limite padrão de {DEFAULT_MAX_ROOMS} quartos.</p> : <ul className="mb-3 text-sm">{plans.map((p) => <li key={p.id}>{p.name} ({p.id}) — até {p.maxRooms} quartos</li>)}</ul>}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Código"><Input value={id} onChange={(e) => setId(e.target.value)} placeholder="basico" /></Field>
        <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Básico" /></Field>
        <Field label="Máx. de quartos"><Input type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} className="w-28" /></Field>
        <Button onClick={save}>Salvar plano</Button>
      </div>
      <p className="mt-2 text-xs text-slate-500">O limite de quartos é aplicado pelo painel da pousada (não há servidor no plano gratuito); trate-o como controle comercial, não como barreira de segurança.</p>
    </Card>
  );
}
