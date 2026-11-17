"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { collection, deleteDoc, doc, documentId, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import { friendlyError, useAuth } from "@/lib/auth/AuthProvider";
import { DEFAULT_MAX_ROOMS } from "@/lib/types";
import { fmtDateTime, toDate } from "@/lib/format";
import { parseStats, parseTenant, tenantLabel, TRIAL_DAYS, type Stats, type TenantRow } from "@/lib/platform";
import { Alert, Button, Card, Field, Input, Spinner } from "@/components/ui";
import { Overview, TenantsPanel, type Patch, type Plan } from "./panels";

const SESSION_MS = 30 * 60_000; // janela de acesso depois de digitar a senha (as Rules exigem login recente)
const TABS = [["geral", "Visão geral"], ["pousadas", "Pousadas"], ["planos", "Planos"], ["atividade", "Atividade"], ["lgpd", "LGPD e segurança"]] as const;
type Tab = (typeof TABS)[number][0];

interface LogRow { id: string; action: string; tenantId: string; at: Date | null }
// Documentos da coleção "platform" separados pelo prefixo do ID (plan-, note-, log-): sem índice composto.
const byPrefix = (prefix: string) => [where(documentId(), ">=", prefix), where(documentId(), "<", `${prefix}\uf8ff`)];

// Painel do dono da plataforma. Acesso: (1) conta listada em platformAdmins, criada no console do Firebase;
// (2) senha digitada há menos de 30 minutos — as Rules conferem o horário do login (auth_time).
// O painel só lê cadastro da pousada, contagens de uso e planos/anotações: nenhum dado de hóspede.
export default function MasterPage() {
  const router = useRouter();
  const { loading, user, logout } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [unlockedAt, setUnlockedAt] = useState<number | null>(null);
  const [tenants, setTenants] = useState<TenantRow[] | null>(null);
  const [stats, setStats] = useState<Record<string, Stats>>({});
  const [plans, setPlans] = useState<Plan[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [tab, setTab] = useState<Tab>("geral");
  const [focus, setFocus] = useState("");
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");

  useEffect(() => { if (!loading && !user) router.replace("/login/?next=/master/"); }, [loading, user, router]);

  // Somente "é administrador?": esta leitura não exige a senha recente.
  useEffect(() => {
    if (!user) return;
    const { db } = getFirebase();
    getDoc(doc(db, `platformAdmins/${user.uid}`)).then((s) => setIsAdmin(s.exists()), () => setIsAdmin(false));
    // Se o login ainda é recente, entra direto; senão, pede a senha.
    user.getIdTokenResult().then((r) => {
      const at = Number(r.claims.auth_time ?? 0) * 1000;
      if (at && Date.now() - at < SESSION_MS - 60_000) setUnlockedAt(at);
    }, () => {});
  }, [user]);

  // Bloqueia sozinho quando a janela de 30 minutos termina.
  useEffect(() => {
    if (unlockedAt === null) return;
    const t = setTimeout(() => setUnlockedAt(null), Math.max(1000, unlockedAt + SESSION_MS - 60_000 - Date.now()));
    return () => clearTimeout(t);
  }, [unlockedAt]);

  const load = useCallback(async () => {
    const { db } = getFirebase();
    const [t, s, p, n, l] = await Promise.all([
      getDocs(collection(db, "tenants")),
      getDocs(collection(db, "tenantStats")),
      getDocs(query(collection(db, "platform"), ...byPrefix("plan-"))),
      getDocs(query(collection(db, "platform"), ...byPrefix("note-"))),
      getDocs(query(collection(db, "platform"), ...byPrefix("log-"), orderBy(documentId(), "desc"), limit(60))),
    ]);
    setTenants(t.docs.map((d) => parseTenant(d.id, d.data())));
    setStats(Object.fromEntries(s.docs.map((d) => [d.id, parseStats(d.data())])));
    setPlans(p.docs.filter((d) => d.data().type === "plan").map((d) => ({ id: d.id, name: d.data().name ?? d.id, maxRooms: Number(d.data().maxRooms ?? DEFAULT_MAX_ROOMS) })));
    setNotes(Object.fromEntries(n.docs.map((d) => [d.id.replace(/^note-/, ""), String(d.data().text ?? "")])));
    setLogs(l.docs.map((d) => ({ id: d.id, action: String(d.data().action ?? ""), tenantId: String(d.data().tenantId ?? ""), at: toDate(d.data().at) })));
    setNow(new Date());
  }, []);
  useEffect(() => {
    if (isAdmin && unlockedAt !== null) void Promise.resolve().then(load).catch((e) => setErr(friendlyError(e)));
  }, [isAdmin, unlockedAt, load]);

  if (loading || !user || isAdmin === null) return <Spinner />;
  if (!isAdmin) return <main className="mx-auto max-w-md p-8"><Alert>Esta área é restrita ao administrador da plataforma.</Alert></main>;
  if (unlockedAt === null) return <Unlock email={user.email ?? ""} onDone={() => setUnlockedAt(Date.now())} onLogout={logout} />;

  const label = (id: string) => { const t = tenants?.find((x) => x.id === id); return t ? tenantLabel(t) : id; };
  const log = (action: string, tenantId: string) =>
    setDoc(doc(getFirebase().db, `platform/log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`), { type: "log", action, tenantId, by: user.uid, at: serverTimestamp() });

  const patch: Patch = async (t, data, action) => {
    setErr(""); setMsg("");
    try {
      await updateDoc(doc(getFirebase().db, `tenants/${t.id}`), data);
      await log(action, t.id);
      setMsg(`${tenantLabel(t)}: ${action}.`);
      await load();
    } catch (e) { setErr(friendlyError(e)); }
  };
  const saveNote = async (t: TenantRow, text: string) => {
    setErr(""); setMsg("");
    try {
      await setDoc(doc(getFirebase().db, `platform/note-${t.id}`), { type: "note", text: text.trim().slice(0, 1000), updatedAt: serverTimestamp() });
      setMsg(`Anotação de ${tenantLabel(t)} salva.`);
      await load();
    } catch (e) { setErr(friendlyError(e)); }
  };

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Painel da plataforma</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => { setErr(""); void load().catch((e) => setErr(friendlyError(e))); }}>Atualizar</Button>
          <Button variant="secondary" onClick={() => setUnlockedAt(null)}>Bloquear</Button>
          <Button variant="secondary" onClick={logout}>Sair</Button>
        </div>
      </div>
      <nav className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map(([id, l]) => (
          <button key={id} onClick={() => { setTab(id); if (id !== "pousadas") setFocus(""); }} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === id ? "border-brand-600 text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900"}`}>{l}</button>
        ))}
      </nav>
      {err && <Alert>{err}</Alert>}{msg && <Alert kind="success">{msg}</Alert>}
      {!tenants ? <Spinner /> : <>
        {tab === "geral" && <Overview tenants={tenants} stats={stats} now={now} onOpen={(id) => { setFocus(id); setTab("pousadas"); }} />}
        {tab === "pousadas" && <TenantsPanel tenants={tenants} stats={stats} plans={plans} notes={notes} now={now} focus={focus} onFocus={setFocus} onPatch={patch} onNote={saveNote} />}
        {tab === "planos" && <Plans plans={plans} onSaved={() => load().catch(() => {})} onError={setErr} />}
        {tab === "atividade" && (
          <Card>
            <h2 className="mb-2 font-semibold">Ações do administrador (últimas {logs.length})</h2>
            {logs.length === 0 ? <p className="text-sm text-slate-500">Nenhuma ação registrada ainda.</p> : (
              <ul className="divide-y divide-slate-100 text-sm">{logs.map((l) => <li key={l.id} className="flex justify-between gap-2 py-2"><span><strong>{label(l.tenantId)}</strong>: {l.action}</span><span className="text-slate-500">{fmtDateTime(l.at)}</span></li>)}</ul>
            )}
          </Card>
        )}
        {tab === "lgpd" && <Privacy />}
      </>}
    </main>
  );
}

function Unlock({ email, onDone, onLogout }: { email: string; onDone: () => void; onLogout: () => void }) {
  const { user } = useAuth();
  const [pw, setPw] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !email) return;
    setBusy(true); setErr("");
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, pw));
      await user.getIdToken(true); // o novo token traz o horário do login que as Rules conferem
      onDone();
    } catch (x) { setErr(friendlyError(x)); } finally { setBusy(false); setPw(""); }
  }
  return (
    <main className="mx-auto max-w-sm space-y-4 p-8">
      <h1 className="text-xl font-bold">Área do administrador</h1>
      <p className="text-sm text-slate-600">Digite a senha da conta {email} para abrir o painel da plataforma. O acesso fecha sozinho depois de 30 minutos.</p>
      {err && <Alert>{err}</Alert>}
      <form onSubmit={submit} className="space-y-3">
        <Field label="Senha"><Input type="password" autoComplete="current-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
        <div className="flex gap-2"><Button type="submit" loading={busy}>Entrar no painel</Button><Button type="button" variant="secondary" onClick={onLogout}>Sair</Button></div>
      </form>
    </main>
  );
}

function Plans({ plans, onSaved, onError }: { plans: Plan[]; onSaved: () => void; onError: (m: string) => void }) {
  const [id, setId] = useState(""); const [name, setName] = useState(""); const [max, setMax] = useState("20");
  async function save() {
    const toSlug = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const slug = toSlug(id) || toSlug(name);
    const n = parseInt(max);
    if (!slug || !name.trim() || !(n >= 1)) return onError("Informe o nome do plano e o limite de quartos.");
    try { const { db } = getFirebase(); await setDoc(doc(db, `platform/plan-${slug}`), { type: "plan", name: name.trim(), maxRooms: n }); setId(""); setName(""); onSaved(); } catch (e) { onError(friendlyError(e)); }
  }
  return (
    <Card>
      <h2 className="mb-2 font-semibold">Planos</h2>
      {plans.length === 0 ? <p className="mb-3 text-sm text-slate-500">Nenhum plano criado. Sem plano, cada pousada usa o limite padrão de {DEFAULT_MAX_ROOMS} quartos.</p> : <ul className="mb-3 space-y-1 text-sm">{plans.map((p) => (
        <li key={p.id} className="flex items-center justify-between gap-2"><span>{p.name} ({p.id.replace(/^plan-/, "")}) — até {p.maxRooms} quartos</span>
          <Button variant="ghost" onClick={async () => { if (!confirm(`Excluir o plano "${p.name}"? Pousadas que já usam este plano mantêm o limite atual.`)) return; try { const { db } = getFirebase(); await deleteDoc(doc(db, `platform/${p.id}`)); onSaved(); } catch (e) { onError(friendlyError(e)); } }}>Excluir</Button></li>))}</ul>}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Código (opcional)"><Input value={id} onChange={(e) => setId(e.target.value)} placeholder="gerado do nome" /></Field>
        <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Básico" /></Field>
        <Field label="Máx. de quartos"><Input type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} className="w-28" /></Field>
        <Button onClick={save}>Salvar plano</Button>
      </div>
      <p className="mt-2 text-xs text-slate-500">O sistema não processa pagamentos: a cobrança é feita por você, fora do sistema. Ao confirmar o pagamento, mude a pousada para “Ativa”; se atrasar, suspenda. Novas pousadas começam em teste de {TRIAL_DAYS} dias. O limite de quartos é aplicado pelo painel da pousada (não há servidor no plano gratuito): trate-o como controle comercial, não como barreira de segurança.</p>
    </Card>
  );
}

function Privacy() {
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-2 font-semibold">O que este painel enxerga</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li><strong>Cadastro da pousada:</strong> nome fantasia, razão social, situação, plano, limite e data de criação.</li>
          <li><strong>Uso agregado:</strong> apenas contagens (quartos, equipe, hospedagens, reservas, hóspedes cadastrados), cidade/UF e a data da última atividade.</li>
          <li><strong>Suas anotações e o registro das suas ações</strong> sobre cada pousada.</li>
        </ul>
      </Card>
      <Card>
        <h2 className="mb-2 font-semibold">O que este painel NÃO enxerga (e nem poderia)</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>Nome, documento, telefone, e-mail, nascimento ou endereço de hóspedes e acompanhantes.</li>
          <li>Valores, pagamentos, caixa, contas a pagar/receber e relatórios financeiros da pousada.</li>
          <li>Mensagens de chat, observações internas e fotos.</li>
        </ul>
        <p className="mt-2 text-xs text-slate-500">Isso é garantido pelas regras do banco de dados, não só pela tela: mesmo com a sua senha, o banco recusa leitura dessas coleções. As pousadas são as <em>controladoras</em> dos dados dos hóspedes (LGPD, art. 5º, VI); você é a <em>operadora</em>.</p>
      </Card>
      <Card>
        <h2 className="mb-2 font-semibold">Segurança do seu acesso</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>Use uma senha longa e exclusiva e proteja o e-mail desta conta.</li>
          <li>Todas as ações de plano, limite, suspensão e cancelamento ficam registradas na aba Atividade.</li>
          <li>Para tirar o acesso de alguém, apague o documento correspondente em <code>platformAdmins</code> no console do Firebase.</li>
          <li>Pedido de eliminação de dados por uma pousada: veja <code>docs/LGPD.md</code> (procedimento e prazos).</li>
        </ul>
      </Card>
    </div>
  );
}
