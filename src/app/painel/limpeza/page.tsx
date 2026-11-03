"use client";

import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, serverTimestamp, writeBatch } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import { friendlyError, useAuth } from "@/lib/auth/AuthProvider";
import { useRooms } from "@/lib/useRooms";
import { fmtDateTime, toDate } from "@/lib/format";
import { ROOM_STATUS_LABELS, ROOM_STATUS_STYLES } from "@/lib/types";
import { Alert, Badge, Button, Card, EmptyState, Spinner } from "@/components/ui";

interface Task { id: string; roomId: string; roomNumber: string; stayId?: string; status: "pending" | "in_progress" | "done"; assignedTo?: string; assignedName?: string; createdAt: Date | null; startedAt: Date | null; finishedAt: Date | null; notes?: string }
const LABEL = { pending: "Aguardando", in_progress: "Em limpeza", done: "Concluída" } as const;

export default function CleaningPage() {
  const { membership, user } = useAuth();
  const t = membership?.tenantId;
  const role = membership?.role;
  const canClean = role === "owner" || role === "admin" || role === "staff"; // regras de quarto: só estes mudam a limpeza
  const { rooms } = useRooms(t);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState("");

  useEffect(() => {
    if (!t) return;
    const { db } = getFirebase();
    return onSnapshot(collection(db, `tenants/${t}/cleaningTasks`), (s) =>
      setTasks(s.docs.map((d) => { const x = d.data(); return { id: d.id, roomId: x.roomId, roomNumber: String(x.roomNumber ?? ""), stayId: x.stayId, status: x.status ?? "pending", assignedTo: x.assignedTo, assignedName: x.assignedName, createdAt: toDate(x.createdAt), startedAt: toDate(x.startedAt), finishedAt: toDate(x.finishedAt), notes: x.notes } as Task; })),
      () => setErr("Não foi possível carregar as tarefas de limpeza."));
  }, [t]);

  if (!t || !user) return <Spinner />;
  if (!tasks || !rooms) return err ? <Alert>{err}</Alert> : <Spinner />;

  const room = (id: string) => rooms.find((r) => r.id === id);
  const open = tasks.filter((x) => x.status !== "done").sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
  const done = tasks.filter((x) => x.status === "done").sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0)).slice(0, 15);
  const name = user.displayName || user.email || "Funcionário";

  async function step(task: Task, to: "in_progress" | "done") {
    if (!t || !user) return;
    setBusy(task.id); setErr("");
    try {
      const { db } = getFirebase();
      const b = writeBatch(db);
      const roomRef = doc(db, `tenants/${t}/rooms/${task.roomId}`);
      if (to === "in_progress") {
        b.update(doc(db, `tenants/${t}/cleaningTasks/${task.id}`), { status: "in_progress", assignedTo: user.uid, assignedName: name, startedAt: serverTimestamp() });
        if (room(task.roomId)?.status === "awaiting_cleaning") b.update(roomRef, { status: "cleaning", updatedAt: serverTimestamp() });
      } else {
        b.update(doc(db, `tenants/${t}/cleaningTasks/${task.id}`), { status: "done", finishedAt: serverTimestamp(), finishedBy: user.uid });
        if (room(task.roomId)?.status === "cleaning") b.update(roomRef, { status: "available", updatedAt: serverTimestamp() });
      }
      b.set(doc(collection(db, `tenants/${t}/auditLogs`)), { actorUid: user.uid, action: `cleaning.${to}`, details: { taskId: task.id, roomId: task.roomId }, at: serverTimestamp() });
      await b.commit();
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(""); }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-slate-900">Limpeza</h1>
      {err && <Alert>{err}</Alert>}
      {!canClean && <Alert kind="info">Seu perfil acompanha a limpeza, mas quem inicia e conclui são funcionários e gestores.</Alert>}
      {open.length === 0 ? <EmptyState title="Nenhum quarto para limpar" text="Quando uma hospedagem for encerrada, o quarto aparece aqui automaticamente." /> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {open.map((x) => {
            const r = room(x.roomId);
            return (
              <Card key={x.id}>
                <div className="flex items-start justify-between gap-2">
                  <div><p className="text-lg font-semibold">Quarto {x.roomNumber}</p><p className="text-xs text-slate-500">Saída em {fmtDateTime(x.createdAt)}</p></div>
                  <div className="flex flex-col items-end gap-1"><Badge className="bg-amber-50 text-amber-800 ring-amber-600/20">{LABEL[x.status]}</Badge>{r && <Badge className={ROOM_STATUS_STYLES[r.status]}>{ROOM_STATUS_LABELS[r.status]}</Badge>}</div>
                </div>
                {x.assignedName && <p className="mt-2 text-sm text-slate-600">Responsável: {x.assignedName}</p>}
                {canClean && (
                  <div className="mt-3">
                    {x.status === "pending" && <Button loading={busy === x.id} onClick={() => step(x, "in_progress")}>Iniciar limpeza</Button>}
                    {x.status === "in_progress" && <Button loading={busy === x.id} onClick={() => step(x, "done")}>Concluir — liberar quarto</Button>}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {done.length > 0 && <Card><h2 className="mb-2 font-semibold">Concluídas recentemente</h2><ul className="divide-y divide-slate-100 text-sm">{done.map((x) => <li key={x.id} className="flex justify-between py-1.5"><span>Quarto {x.roomNumber}{x.assignedName ? ` · ${x.assignedName}` : ""}</span><span className="text-slate-500">{fmtDateTime(x.finishedAt)}</span></li>)}</ul></Card>}
    </div>
  );
}
