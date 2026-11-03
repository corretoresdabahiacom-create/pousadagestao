"use client";

import { useMemo, useState, type FormEvent } from "react";
import { addDoc, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import { audit } from "@/lib/audit";
import { friendlyError, useAuth } from "@/lib/auth/AuthProvider";
import { useRooms } from "@/lib/useRooms";
import { centsToInput, formatCents, parseBRLToCents } from "@/lib/money";
import {
  ROOM_CATEGORIES,
  ROOM_STATUS_LABELS,
  ROOM_STATUS_STYLES,
  isManager,
  type Room,
  type RoomStatus,
} from "@/lib/types";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, Textarea } from "@/components/ui";

interface RoomForm {
  number: string;
  name: string;
  categoryId: string;
  description: string;
  capacity: string;
  beds: string;
  dailyRate: string;
  extraPerson: string;
  amenities: string;
  notes: string;
}

const emptyForm: RoomForm = {
  number: "",
  name: "",
  categoryId: "casal",
  description: "",
  capacity: "2",
  beds: "1",
  dailyRate: "",
  extraPerson: "",
  amenities: "",
  notes: "",
};

const categoryLabel = (id: string) => ROOM_CATEGORIES.find((c) => c.id === id)?.label ?? "Outras";

// Estados que o gestor pode definir à mão. Ocupado/limpeza mudam pelo fluxo de hospedagem.
const MANUAL: RoomStatus[] = ["available", "maintenance", "blocked"];

export default function RoomsPage() {
  const { user, membership } = useAuth();
  const tenantId = membership?.tenantId;
  const canEdit = isManager(membership?.role);
  const { rooms, error } = useRooms(tenantId);

  const [view, setView] = useState<"cards" | "list">("cards");
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Room | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rooms ?? []).filter(
      (r) =>
        (showArchived || !r.archived) &&
        (!q || r.number.toLowerCase().includes(q) || (r.name ?? "").toLowerCase().includes(q)),
    );
  }, [rooms, showArchived, query]);

  if (error) return <Alert>{error}</Alert>;
  if (!rooms || !tenantId || !user) return <Spinner />;

  async function changeStatus(room: Room, status: RoomStatus) {
    setActionError("");
    try {
      const { db } = getFirebase();
      await updateDoc(doc(db, `tenants/${tenantId}/rooms/${room.id}`), { status, updatedAt: serverTimestamp() });
      await audit(tenantId!, user!.uid, "room.status", { roomId: room.id, number: room.number, from: room.status, to: status });
    } catch (e) {
      setActionError(friendlyError(e));
    }
  }

  async function toggleArchive(room: Room) {
    setActionError("");
    try {
      const { db } = getFirebase();
      const archived = !room.archived;
      await updateDoc(doc(db, `tenants/${tenantId}/rooms/${room.id}`), { archived, updatedAt: serverTimestamp() });
      await audit(tenantId!, user!.uid, archived ? "room.archive" : "room.restore", { roomId: room.id, number: room.number });
      setNotice(archived ? `Quarto ${room.number} arquivado.` : `Quarto ${room.number} restaurado.`);
    } catch (e) {
      setActionError(friendlyError(e));
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Quartos</h1>
          <p className="text-sm text-slate-600">
            {rooms.filter((r) => !r.archived).length} quarto(s) ativo(s)
          </p>
        </div>
        {canEdit && <Button onClick={() => setEditing("new")}>Novo quarto</Button>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-64">
          <Input placeholder="Buscar por número ou nome" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar quarto" />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Mostrar arquivados
        </label>
        <div className="ml-auto inline-flex rounded-lg bg-slate-100 p-1 text-sm">
          {(["cards", "list"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 ${view === v ? "bg-white text-teal-800 shadow-sm" : "text-slate-600"}`}
            >
              {v === "cards" ? "Cartões" : "Lista"}
            </button>
          ))}
        </div>
      </div>

      {notice && <Alert kind="success">{notice}</Alert>}
      {actionError && <Alert>{actionError}</Alert>}

      {visible.length === 0 ? (
        <EmptyState
          title={rooms.length === 0 ? "Nenhum quarto cadastrado" : "Nenhum quarto encontrado"}
          text={rooms.length === 0 ? "Cadastre o primeiro quarto da pousada." : "Ajuste a busca ou mostre os arquivados."}
          action={canEdit && rooms.length === 0 ? <Button onClick={() => setEditing("new")}>Novo quarto</Button> : undefined}
        />
      ) : view === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((r) => (
            <Card key={r.id} className={r.archived ? "opacity-60" : ""}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-bold">Quarto {r.number}</p>
                  {r.name && <p className="text-sm text-slate-600">{r.name}</p>}
                </div>
                <Badge className={ROOM_STATUS_STYLES[r.status]}>{ROOM_STATUS_LABELS[r.status]}</Badge>
              </div>
              <dl className="mt-3 space-y-1 text-sm text-slate-700">
                <div className="flex justify-between"><dt className="text-slate-500">Categoria</dt><dd>{categoryLabel(r.categoryId)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Capacidade</dt><dd>{r.capacity} pessoa(s) · {r.beds} cama(s)</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Diária</dt><dd className="font-semibold">{formatCents(r.dailyRateCents)}</dd></div>
              </dl>
              {r.archived && <p className="mt-2 text-xs font-medium text-slate-500">Arquivado</p>}
              {canEdit && <RoomActions room={r} onEdit={() => setEditing(r)} onStatus={changeStatus} onArchive={toggleArchive} />}
            </Card>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Quarto</th>
                <th className="px-4 py-3">Categoria</th>
                <th className="px-4 py-3">Cap.</th>
                <th className="px-4 py-3">Diária</th>
                <th className="px-4 py-3">Situação</th>
                {canEdit && <th className="px-4 py-3 text-right">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((r) => (
                <tr key={r.id} className={r.archived ? "opacity-60" : ""}>
                  <td className="px-4 py-3 font-medium">{r.number}{r.name ? ` · ${r.name}` : ""}{r.archived ? " (arquivado)" : ""}</td>
                  <td className="px-4 py-3">{categoryLabel(r.categoryId)}</td>
                  <td className="px-4 py-3">{r.capacity}</td>
                  <td className="px-4 py-3">{formatCents(r.dailyRateCents)}</td>
                  <td className="px-4 py-3"><Badge className={ROOM_STATUS_STYLES[r.status]}>{ROOM_STATUS_LABELS[r.status]}</Badge></td>
                  {canEdit && (
                    <td className="px-4 py-3">
                      <RoomActions room={r} onEdit={() => setEditing(r)} onStatus={changeStatus} onArchive={toggleArchive} compact />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <RoomModal
          room={editing === "new" ? null : editing}
          existing={rooms}
          tenantId={tenantId}
          uid={user.uid}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            setNotice(msg);
          }}
        />
      )}
    </div>
  );
}

function RoomActions({
  room,
  onEdit,
  onStatus,
  onArchive,
  compact,
}: {
  room: Room;
  onEdit: () => void;
  onStatus: (r: Room, s: RoomStatus) => void;
  onArchive: (r: Room) => void;
  compact?: boolean;
}) {
  const manual = MANUAL.includes(room.status);
  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? "justify-end" : "mt-4 border-t border-slate-100 pt-3"}`}>
      <Button variant="secondary" className="px-3 py-1.5" onClick={onEdit}>Editar</Button>
      {manual && !room.archived && (
        <Select
          aria-label={`Situação do quarto ${room.number}`}
          value={room.status}
          onChange={(e) => onStatus(room, e.target.value as RoomStatus)}
          className="!w-auto !py-1.5"
        >
          {MANUAL.map((s) => (
            <option key={s} value={s}>{ROOM_STATUS_LABELS[s]}</option>
          ))}
        </Select>
      )}
      {manual && (
        <Button variant="ghost" className="px-3 py-1.5" onClick={() => onArchive(room)}>
          {room.archived ? "Restaurar" : "Arquivar"}
        </Button>
      )}
      {!manual && <span className="text-xs text-slate-500">Situação muda pelo fluxo de hospedagem</span>}
    </div>
  );
}

function RoomModal({
  room,
  existing,
  tenantId,
  uid,
  onClose,
  onSaved,
}: {
  room: Room | null;
  existing: Room[];
  tenantId: string;
  uid: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [f, setF] = useState<RoomForm>(
    room
      ? {
          number: room.number,
          name: room.name ?? "",
          categoryId: room.categoryId,
          description: room.description ?? "",
          capacity: String(room.capacity),
          beds: String(room.beds),
          dailyRate: centsToInput(room.dailyRateCents),
          extraPerson: centsToInput(room.extraPersonCents),
          amenities: room.amenities.join(", "),
          notes: room.notes ?? "",
        }
      : emptyForm,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof RoomForm) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const number = f.number.trim();
    const daily = parseBRLToCents(f.dailyRate);
    const extra = f.extraPerson.trim() ? parseBRLToCents(f.extraPerson) : null;
    const capacity = Number(f.capacity);
    const beds = Number(f.beds);

    if (!number) return setError("Informe o número ou a identificação do quarto.");
    if (existing.some((r) => r.id !== room?.id && r.number.toLowerCase() === number.toLowerCase()))
      return setError(`Já existe um quarto com o número ${number}.`);
    if (daily === null) return setError("Informe um valor de diária válido. Ex.: 180,00");
    if (f.extraPerson.trim() && extra === null) return setError("Valor de pessoa adicional inválido.");
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) return setError("Capacidade deve ser um número inteiro de 1 a 50.");
    if (!Number.isInteger(beds) || beds < 0 || beds > 50) return setError("Quantidade de camas inválida.");

    const data = {
      number,
      name: f.name.trim(),
      categoryId: f.categoryId,
      description: f.description.trim(),
      capacity,
      beds,
      dailyRateCents: daily,
      extraPersonCents: extra,
      amenities: f.amenities.split(",").map((s) => s.trim()).filter(Boolean),
      notes: f.notes.trim(),
      updatedAt: serverTimestamp(),
    };

    setBusy(true);
    try {
      const { db } = getFirebase();
      if (room) {
        await updateDoc(doc(db, `tenants/${tenantId}/rooms/${room.id}`), data);
        await audit(tenantId, uid, "room.update", { roomId: room.id, number });
        onSaved(`Quarto ${number} atualizado.`);
      } else {
        const ref = await addDoc(collection(db, `tenants/${tenantId}/rooms`), {
          ...data,
          status: "available",
          archived: false,
          createdAt: serverTimestamp(),
        });
        await audit(tenantId, uid, "room.create", { roomId: ref.id, number });
        onSaved(`Quarto ${number} cadastrado.`);
      }
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={room ? `Editar quarto ${room.number}` : "Novo quarto"} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Número / identificação">
            <Input value={f.number} onChange={set("number")} required />
          </Field>
          <Field label="Nome (opcional)">
            <Input value={f.name} onChange={set("name")} />
          </Field>
          <Field label="Categoria">
            <Select value={f.categoryId} onChange={set("categoryId")}>
              {ROOM_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Capacidade máxima">
            <Input type="number" min={1} max={50} value={f.capacity} onChange={set("capacity")} required />
          </Field>
          <Field label="Camas">
            <Input type="number" min={0} max={50} value={f.beds} onChange={set("beds")} required />
          </Field>
          <div />
          <Field label="Valor da diária (R$)" hint="Use vírgula para os centavos.">
            <Input inputMode="decimal" value={f.dailyRate} onChange={set("dailyRate")} placeholder="180,00" required />
          </Field>
          <Field label="Pessoa adicional (R$)" hint="Opcional.">
            <Input inputMode="decimal" value={f.extraPerson} onChange={set("extraPerson")} placeholder="40,00" />
          </Field>
        </div>
        <Field label="Descrição">
          <Textarea rows={2} value={f.description} onChange={set("description")} />
        </Field>
        <Field label="Comodidades" hint="Separe por vírgula. Ex.: ar-condicionado, TV, frigobar">
          <Input value={f.amenities} onChange={set("amenities")} />
        </Field>
        <Field label="Observações internas" hint="Só a equipe vê.">
          <Textarea rows={2} value={f.notes} onChange={set("notes")} />
        </Field>

        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}
