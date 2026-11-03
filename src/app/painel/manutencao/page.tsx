"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Timestamp, collection, doc, onSnapshot, serverTimestamp, writeBatch } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import { friendlyError, useAuth } from "@/lib/auth/AuthProvider";
import { useRooms } from "@/lib/useRooms";
import { fmtDateTime, toDate } from "@/lib/format";
import { formatCents, parseBRLToCents } from "@/lib/money";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, Textarea } from "@/components/ui";

type Prio = "low" | "medium" | "high" | "urgent";
type St = "open" | "in_progress" | "done" | "cancelled";
interface Ticket { id: string; roomId: string | null; roomNumber: string; title: string; description: string; priority: Prio; status: St; costCents: number; blocksRoom: boolean; payableId?: string; createdAt: Date | null; finishedAt: Date | null }
const PRIO: Record<Prio, { l: string; c: string }> = { low: { l: "Baixa", c: "bg-slate-100 text-slate-700 ring-slate-500/20" }, medium: { l: "Média", c: "bg-sky-50 text-sky-700 ring-sky-600/20" }, high: { l: "Alta", c: "bg-orange-50 text-orange-700 ring-orange-600/20" }, urgent: { l: "Urgente", c: "bg-red-50 text-red-700 ring-red-600/20" } };
const ST: Record<St, string> = { open: "Aberto", in_progress: "Em andamento", done: "Concluído", cancelled: "Cancelado" };

export default function MaintenancePage() {
  const { membership, user } = useAuth();
  const t = membership?.tenantId; const role = membership?.role;
  const isMgr = role === "owner" || role === "admin";
  const { rooms } = useRooms(t);
  const [list, setList] = useState<Ticket[] | null>(null);
  const [err, setErr] = useState(""); const [modal, setModal] = useState(false); const [finish, setFinish] = useState<Ticket | null>(null); const [tab, setTab] = useState<"open" | "done">("open");

  useEffect(() => {
    if (!t) return;
    const { db } = getFirebase();
    return onSnapshot(collection(db, `tenants/${t}/maintenanceTickets`), (s) =>
      setList(s.docs.map((d) => { const x = d.data(); return { id: d.id, roomId: x.roomId ?? null, roomNumber: x.roomNumber ?? "", title: x.title ?? "", description: x.description ?? "", priority: x.priority ?? "medium", status: x.status ?? "open", costCents: Number(x.costCents ?? 0), blocksRoom: x.blocksRoom === true, payableId: x.payableId, createdAt: toDate(x.createdAt), finishedAt: toDate(x.finishedAt) } as Ticket; })),
      () => setErr("Não foi possível carregar os chamados."));
  }, [t]);

  if (!t || !user) return <Spinner />;
  if (!list || !rooms) return err ? <Alert>{err}</Alert> : <Spinner />;
  const rank: Record<Prio, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  const shown = list.filter((x) => (tab === "open" ? x.status === "open" || x.status === "in_progress" : x.status === "done" || x.status === "cancelled"))
    .sort((a, b) => (tab === "open" ? rank[a.priority] - rank[b.priority] : (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0)));

  async function create(f: { roomId: string; title: string; description: string; priority: Prio; blocks: boolean }) {
    const { db } = getFirebase();
    const room = rooms!.find((r) => r.id === f.roomId);
    const b = writeBatch(db);
    const ref = doc(collection(db, `tenants/${t}/maintenanceTickets`));
    b.set(ref, { roomId: f.roomId || null, roomNumber: room?.number ?? "", title: f.title, description: f.description, priority: f.priority, status: "open", costCents: 0, blocksRoom: f.blocks && !!room && isMgr && room.status === "available", createdBy: user!.uid, createdAt: serverTimestamp() });
    // Só gestores alteram o estado do quarto (Rules); só bloqueia quarto livre — nunca um com hóspede.
    if (f.blocks && room && isMgr && room.status === "available") b.update(doc(db, `tenants/${t}/rooms/${room.id}`), { status: "maintenance", updatedAt: serverTimestamp() });
    b.set(doc(collection(db, `tenants/${t}/auditLogs`)), { actorUid: user!.uid, action: "maintenance.create", details: { ticketId: ref.id, roomId: f.roomId, priority: f.priority }, at: serverTimestamp() });
    await b.commit();
  }

  async function setStatus(x: Ticket, status: St) {
    try {
      const { db } = getFirebase();
      const b = writeBatch(db);
      b.update(doc(db, `tenants/${t}/maintenanceTickets/${x.id}`), { status, updatedAt: serverTimestamp(), ...(status === "cancelled" ? { finishedAt: serverTimestamp() } : {}) });
      b.set(doc(collection(db, `tenants/${t}/auditLogs`)), { actorUid: user!.uid, action: `maintenance.${status}`, details: { ticketId: x.id }, at: serverTimestamp() });
      await b.commit();
    } catch (e) { setErr(friendlyError(e)); }
  }

  async function conclude(x: Ticket, costCents: number, createPayable: boolean) {
    const { db } = getFirebase();
    const b = writeBatch(db);
    const payableId = createPayable && costCents > 0 ? `maint-${x.id}` : undefined;
    b.update(doc(db, `tenants/${t}/maintenanceTickets/${x.id}`), { status: "done", costCents, payableId: payableId ?? null, finishedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    const room = x.roomId ? rooms!.find((r) => r.id === x.roomId) : undefined;
    if (isMgr && room?.status === "maintenance" && x.blocksRoom) b.update(doc(db, `tenants/${t}/rooms/${room.id}`), { status: "available", updatedAt: serverTimestamp() });
    if (payableId) {
      const now = Timestamp.now();
      b.set(doc(db, `tenants/${t}/accountsPayable/${payableId}`), { supplier: "", description: `Manutenção — ${x.title}${x.roomNumber ? ` (quarto ${x.roomNumber})` : ""}`, category: "Manutenção", amountCents: costCents, dueDate: now, competenceDate: now, status: "open", origin: "manutencao", ticketId: x.id, createdBy: user!.uid, createdAt: serverTimestamp() });
    }
    b.set(doc(collection(db, `tenants/${t}/auditLogs`)), { actorUid: user!.uid, action: "maintenance.done", details: { ticketId: x.id, costCents, payable: !!payableId }, at: serverTimestamp() });
    await b.commit();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-bold text-slate-900">Manutenção</h1><Button onClick={() => setModal(true)}>+ Novo chamado</Button></div>
      {err && <Alert>{err}</Alert>}
      <div className="flex gap-1">{(["open", "done"] as const).map((k) => <button key={k} onClick={() => setTab(k)} className={`rounded-full px-3 py-1 text-sm ${tab === k ? "bg-brand-700 text-white" : "bg-white text-slate-700 ring-1 ring-slate-300"}`}>{k === "open" ? "Abertos" : "Encerrados"}</button>)}</div>
      {shown.length === 0 ? <EmptyState title="Nenhum chamado" text="Registre problemas em quartos ou áreas comuns para acompanhar o conserto." /> : (
        <div className="space-y-3">
          {shown.map((x) => (
            <Card key={x.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><p className="font-semibold">{x.title}</p><p className="text-sm text-slate-500">{x.roomNumber ? `Quarto ${x.roomNumber}` : "Área comum"} · aberto {fmtDateTime(x.createdAt)}</p></div>
                <div className="flex gap-1"><Badge className={PRIO[x.priority].c}>{PRIO[x.priority].l}</Badge><Badge className="bg-slate-100 text-slate-700 ring-slate-500/20">{ST[x.status]}</Badge></div>
              </div>
              {x.description && <p className="mt-2 text-sm text-slate-700">{x.description}</p>}
              {x.status === "done" && <p className="mt-2 text-sm text-slate-600">Custo: {formatCents(x.costCents)}{x.payableId ? " · conta a pagar criada" : ""}</p>}
              {(x.status === "open" || x.status === "in_progress") && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {x.status === "open" && <Button variant="secondary" onClick={() => setStatus(x, "in_progress")}>Iniciar</Button>}
                  <Button onClick={() => setFinish(x)}>Concluir</Button>
                  {isMgr && <Button variant="ghost" onClick={() => setStatus(x, "cancelled")}>Cancelar chamado</Button>}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      {modal && <NewModal isMgr={isMgr} rooms={rooms} onClose={() => setModal(false)} onSave={async (f) => { try { await create(f); setModal(false); } catch (e) { setErr(friendlyError(e)); } }} />}
      {finish && <FinishModal x={finish} canPay={isMgr} onClose={() => setFinish(null)} onSave={async (c, p) => { try { await conclude(finish, c, p); setFinish(null); } catch (e) { setErr(friendlyError(e)); } }} />}
    </div>
  );
}

function NewModal({ rooms, isMgr, onClose, onSave }: { rooms: { id: string; number: string; archived?: boolean }[]; isMgr: boolean; onClose: () => void; onSave: (f: { roomId: string; title: string; description: string; priority: Prio; blocks: boolean }) => Promise<void> }) {
  const [f, setF] = useState({ roomId: "", title: "", description: "", priority: "medium" as Prio, blocks: false }); const [busy, setBusy] = useState(false); const [e, setE] = useState("");
  return (
    <Modal title="Novo chamado de manutenção" onClose={onClose}>
      <form className="space-y-3" onSubmit={async (ev: FormEvent) => { ev.preventDefault(); if (!f.title.trim()) return setE("Informe o problema."); setBusy(true); await onSave({ ...f, title: f.title.trim() }); setBusy(false); }}>
        {e && <Alert>{e}</Alert>}
        <Field label="Local"><Select value={f.roomId} onChange={(x) => setF({ ...f, roomId: x.target.value })}><option value="">Área comum</option>{rooms.filter((r) => !r.archived).map((r) => <option key={r.id} value={r.id}>Quarto {r.number}</option>)}</Select></Field>
        <Field label="Problema"><Input value={f.title} maxLength={120} onChange={(x) => setF({ ...f, title: x.target.value })} /></Field>
        <Field label="Detalhes"><Textarea rows={3} maxLength={1000} value={f.description} onChange={(x) => setF({ ...f, description: x.target.value })} /></Field>
        <Field label="Prioridade"><Select value={f.priority} onChange={(x) => setF({ ...f, priority: x.target.value as Prio })}>{(Object.keys(PRIO) as Prio[]).map((p) => <option key={p} value={p}>{PRIO[p].l}</option>)}</Select></Field>
        {isMgr && f.roomId && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.blocks} onChange={(x) => setF({ ...f, blocks: x.target.checked })} /> Bloquear o quarto para reservas (só se estiver livre)</label>}
        <Button type="submit" loading={busy}>Abrir chamado</Button>
      </form>
    </Modal>
  );
}
function FinishModal({ x, canPay, onClose, onSave }: { x: Ticket; canPay: boolean; onClose: () => void; onSave: (c: number, p: boolean) => Promise<void> }) {
  const [cost, setCost] = useState(""); const [pay, setPay] = useState(false); const [busy, setBusy] = useState(false); const [e, setE] = useState("");
  return (
    <Modal title={`Concluir: ${x.title}`} onClose={onClose}>
      <form className="space-y-3" onSubmit={async (ev: FormEvent) => { ev.preventDefault(); const c = cost.trim() ? parseBRLToCents(cost) : 0; if (c === null || c < 0) return setE("Valor inválido."); setBusy(true); await onSave(c, pay); setBusy(false); }}>
        <Field label="Custo do conserto (R$, opcional)" error={e}><Input inputMode="decimal" value={cost} onChange={(v) => setCost(v.target.value)} /></Field>
        {canPay ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pay} onChange={(v) => setPay(v.target.checked)} /> Criar conta a pagar com este custo (categoria Manutenção, em aberto)</label> : <p className="text-xs text-slate-500">Somente gestores criam a conta a pagar.</p>}
        <Button type="submit" loading={busy}>Concluir chamado</Button>
      </form>
    </Modal>
  );
}
