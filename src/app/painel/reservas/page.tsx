"use client";

import { Suspense, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { User } from "firebase/auth";
import { friendlyError, useAuth } from "@/lib/auth/AuthProvider";
import { useRooms } from "@/lib/useRooms";
import { useActiveStays } from "@/lib/useStays";
import { useReservations, useRoomSchedules } from "@/lib/useReservations";
import { usePublicInfo } from "@/lib/usePublicInfo";
import {
  SOURCES,
  STATUS_LABEL,
  cancelReservation,
  createReservation,
  sourceLabel,
  updateReservation,
  type Reservation,
  type ReservationSource,
} from "@/lib/reservations";
import { findConflicts, type Schedule } from "@/lib/schedule";
import { StayError, computePlanned, type Stay } from "@/lib/stays";
import type { Room } from "@/lib/types";
import { addNights, countNights, fmtDateTime, fromLocalInput, toLocalInput } from "@/lib/format";
import { centsToInput, formatCents, parseBRLToCents } from "@/lib/money";
import { reservationMessage, waLink } from "@/lib/whatsapp";
import { useNow } from "@/lib/useNow";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, Textarea } from "@/components/ui";

export default function ReservationsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Reservations />
    </Suspense>
  );
}

const BADGE: Record<Reservation["status"], string> = {
  confirmed: "bg-amber-50 text-amber-800 ring-amber-600/20",
  checked_in: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  cancelled: "bg-slate-100 text-slate-600 ring-slate-500/20",
  no_show: "bg-red-50 text-red-700 ring-red-600/20",
};

function Reservations() {
  const params = useSearchParams();
  const { user, membership, tenant } = useAuth();
  const t = membership?.tenantId;
  const role = membership?.role ?? "";
  const canEdit = ["owner", "admin", "reception"].includes(role);
  const allowed = canEdit || role === "finance";
  const { rooms } = useRooms(allowed ? t : undefined);
  const act = useActiveStays(allowed ? t : undefined);
  const schedules = useRoomSchedules(allowed ? t : undefined);
  const { reservations, error } = useReservations(allowed ? t : undefined);
  const pub = usePublicInfo(allowed ? t : undefined);
  const now = useNow(60000);
  const [editing, setEditing] = useState<Reservation | "new" | null>(params.get("nova") ? "new" : null);
  const [cancelling, setCancelling] = useState<{ r: Reservation; noShow: boolean } | null>(null);
  const [notice, setNotice] = useState("");
  const focus = params.get("id");

  if (!allowed) return <Alert>Seu perfil não tem acesso às reservas.</Alert>;
  if (error) {
    return (
      <Alert>
        {error} Se o sistema acabou de ser atualizado, as regras de segurança novas ainda precisam ser publicadas no Firebase
        (comando <code>npx firebase deploy --only firestore:rules</code>, no README).
      </Alert>
    );
  }
  if (!t || !user || !rooms || !reservations || !schedules || !act.stays) return <Spinner />;

  const confirmed = reservations.filter((r) => r.status === "confirmed");
  const late = confirmed.filter((r) => r.checkInAt.getTime() < now);
  const upcoming = confirmed.filter((r) => r.checkInAt.getTime() >= now);
  const history = reservations.filter((r) => r.status !== "confirmed").reverse().slice(0, 40);
  const pousada = pub.displayName || tenant?.displayName || tenant?.name;

  const row = (r: Reservation) => {
    const wa = canEdit && r.status === "confirmed"
      ? waLink(r.guestPhone, reservationMessage({ guestName: r.guestName, roomNumber: r.roomNumber, checkInAt: r.checkInAt, plannedCheckOutAt: r.plannedCheckOutAt, nights: r.nights, totalCents: r.totalPlannedCents, pousada }))
      : null;
    return (
      <li key={r.id} className={`flex flex-wrap items-start justify-between gap-3 py-3 ${focus === r.id ? "rounded-lg bg-brand-50 px-2" : ""}`}>
        <div className="min-w-0">
          <p className="font-medium text-slate-900">
            Quarto {r.roomNumber} · {r.guestName}{" "}
            <Badge className={BADGE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
          </p>
          <p className="text-sm text-slate-600">
            Chegada {fmtDateTime(r.checkInAt)} · saída {fmtDateTime(r.plannedCheckOutAt)} · {r.nights} diária{r.nights === 1 ? "" : "s"} · {formatCents(r.totalPlannedCents)}
          </p>
          <p className="text-xs text-slate-500">
            {r.adults} adulto{r.adults === 1 ? "" : "s"}{r.children ? ` · ${r.children} criança${r.children === 1 ? "" : "s"}` : ""} · {sourceLabel(r.source)}{r.guestPhone ? ` · ${r.guestPhone}` : ""}
          </p>
          {r.notes && <p className="text-xs text-slate-500">Obs.: {r.notes}</p>}
          {r.cancelReason && <p className="text-xs text-slate-500">Motivo: {r.cancelReason}</p>}
          {r.stayId && <Link href={`/painel/hospedagem/?id=${r.stayId}`} className="text-xs text-brand-700 hover:underline">Ver hospedagem</Link>}
        </div>
        {canEdit && r.status === "confirmed" && (
          <div className="flex flex-wrap gap-2">
            <Link href={`/painel/checkin/?reserva=${r.id}`} className="inline-flex rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800">Fazer check-in</Link>
            {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50">Confirmar no WhatsApp</a>}
            <Button variant="secondary" className="px-3 py-1.5" onClick={() => setEditing(r)}>Alterar</Button>
            {r.checkInAt.getTime() < now && <Button variant="secondary" className="px-3 py-1.5" onClick={() => setCancelling({ r, noShow: true })}>Não compareceu</Button>}
            <Button variant="secondary" className="px-3 py-1.5" onClick={() => setCancelling({ r, noShow: false })}>Cancelar</Button>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reservas</h1>
          <p className="text-sm text-slate-600">Quartos reservados para datas futuras. O sistema não deixa reservar o mesmo quarto em horários que se cruzam.</p>
        </div>
        {canEdit && <Button onClick={() => { setNotice(""); setEditing("new"); }}>Nova reserva</Button>}
      </div>
      {notice && <Alert kind="success">{notice}</Alert>}

      {late.length > 0 && (
        <Card>
          <h2 className="mb-1 text-base font-semibold text-red-700">Chegada já passou ({late.length})</h2>
          <p className="mb-1 text-xs text-slate-500">Faça o check-in, altere a data ou marque &quot;não compareceu&quot; para liberar o quarto.</p>
          <ul className="divide-y divide-slate-100">{late.map(row)}</ul>
        </Card>
      )}

      <Card>
        <h2 className="mb-1 text-base font-semibold">Próximas chegadas ({upcoming.length})</h2>
        {upcoming.length === 0
          ? <EmptyState title="Nenhuma reserva futura" text={canEdit ? "Use \"Nova reserva\" para reservar um quarto." : "Quando a recepção registrar reservas, elas aparecem aqui."} />
          : <ul className="divide-y divide-slate-100">{upcoming.map(row)}</ul>}
      </Card>

      {history.length > 0 && (
        <Card>
          <h2 className="mb-1 text-base font-semibold">Histórico recente</h2>
          <ul className="divide-y divide-slate-100">{history.map(row)}</ul>
        </Card>
      )}

      {editing && (
        <Modal title={editing === "new" ? "Nova reserva" : `Alterar reserva — ${editing.guestName}`} onClose={() => setEditing(null)}>
          <ReservationForm
            tenantId={t}
            user={user}
            rooms={rooms}
            schedules={schedules}
            activeStays={act.stays}
            initial={editing === "new" ? undefined : editing}
            onDone={(msg) => { setEditing(null); setNotice(msg); }}
          />
        </Modal>
      )}

      {cancelling && (
        <Modal title={cancelling.noShow ? "Hóspede não compareceu" : "Cancelar reserva"} onClose={() => setCancelling(null)}>
          <CancelForm
            noShow={cancelling.noShow}
            onConfirm={async (reason) => {
              await cancelReservation(t, user, cancelling.r, reason, cancelling.noShow);
              setCancelling(null);
              setNotice(cancelling.noShow ? "Reserva marcada como não compareceu. O quarto foi liberado." : "Reserva cancelada. O quarto foi liberado.");
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function CancelForm({ noShow, onConfirm }: { noShow: boolean; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!noShow && !reason.trim()) return setErr("Informe o motivo do cancelamento.");
    setBusy(true);
    setErr("");
    try {
      await onConfirm(reason);
    } catch (x) {
      setErr(x instanceof StayError ? x.message : friendlyError(x));
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label={noShow ? "Observação (opcional)" : "Motivo"}>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={3} />
      </Field>
      {err && <Alert>{err}</Alert>}
      <Button type="submit" loading={busy}>{noShow ? "Marcar não compareceu" : "Cancelar reserva"}</Button>
    </form>
  );
}

function defaultArrival(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(12, 0, 0, 0);
  return d;
}

function ReservationForm({
  tenantId,
  user,
  rooms,
  schedules,
  activeStays,
  initial,
  onDone,
}: {
  tenantId: string;
  user: User;
  rooms: Room[];
  schedules: Record<string, Schedule>;
  activeStays: Stay[];
  initial?: Reservation;
  onDone: (msg: string) => void;
}) {
  const [arrival0] = useState(() => initial?.checkInAt ?? defaultArrival());
  const [guestName, setGuestName] = useState(initial?.guestName ?? "");
  const [guestPhone, setGuestPhone] = useState(initial?.guestPhone ?? "");
  const [guestEmail, setGuestEmail] = useState(initial?.guestEmail ?? "");
  const [adults, setAdults] = useState(initial?.adults ?? 1);
  const [children, setChildren] = useState(initial?.children ?? 0);
  const [checkIn, setCheckIn] = useState(toLocalInput(arrival0));
  const [nights, setNights] = useState(initial?.nights ?? 1);
  const [checkOut, setCheckOut] = useState(toLocalInput(initial?.plannedCheckOutAt ?? addNights(arrival0, 1)));
  const [roomId, setRoomId] = useState(initial?.roomId ?? "");
  const [rateText, setRateText] = useState(initial ? centsToInput(initial.dailyRateCents) : "");
  const [discountText, setDiscountText] = useState(initial?.discountCents ? centsToInput(initial.discountCents) : "");
  const [feesText, setFeesText] = useState(initial?.feesCents ? centsToInput(initial.feesCents) : "");
  const [source, setSource] = useState<ReservationSource>(initial?.source ?? "whatsapp");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const inDate = fromLocalInput(checkIn);
  const outDate = fromLocalInput(checkOut);
  const datesOk = !!inDate && !!outDate && outDate > inDate;
  const list = useMemo(() => rooms.filter((r) => !r.archived).sort((a, b) => a.number.localeCompare(b.number, "pt-BR", { numeric: true })), [rooms]);
  const ignoreId = initial?.id;
  // Para cada quarto: motivo de estar indisponível no período escolhido (reserva ou hóspede na casa).
  const busyByRoom = useMemo(() => {
    const m: Record<string, string> = {};
    const a = fromLocalInput(checkIn);
    const b = fromLocalInput(checkOut);
    if (!a || !b || b <= a) return m;
    for (const r of list) {
      const st = activeStays.find((s) => s.roomId === r.id) ?? null;
      const c = findConflicts(schedules[r.id] ?? {}, a, b, { ignore: ignoreId, activeStay: st, now: new Date() });
      if (c.length) m[r.id] = c[0].kind === "stay" ? `hospedado até ${fmtDateTime(c[0].end)}` : `reservado: ${c[0].guestName}`;
    }
    return m;
  }, [list, schedules, activeStays, checkIn, checkOut, ignoreId]);
  const room = list.find((r) => r.id === roomId);

  const rateCents = rateText ? parseBRLToCents(rateText) : (room?.dailyRateCents ?? 0);
  const discountCents = discountText ? parseBRLToCents(discountText) : 0;
  const feesCents = feesText ? parseBRLToCents(feesText) : 0;
  const valid = datesOk && rateCents !== null && discountCents !== null && feesCents !== null;
  const planned = valid ? computePlanned(rateCents!, countNights(inDate!, outDate!), discountCents!, feesCents!) : null;

  function changeNights(n: number) {
    const v = Math.min(366, Math.max(1, Math.floor(n) || 1));
    setNights(v);
    if (inDate) setCheckOut(toLocalInput(addNights(inDate, v)));
  }
  function changeCheckIn(v: string) {
    setCheckIn(v);
    const d = fromLocalInput(v);
    if (d) setCheckOut(toLocalInput(addNights(d, nights)));
  }
  function changeCheckOut(v: string) {
    setCheckOut(v);
    const d = fromLocalInput(v);
    if (d && inDate && d > inDate) setNights(countNights(inDate, d));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    if (!room) return setErr("Escolha o quarto.");
    if (busyByRoom[room.id]) return setErr(`Quarto ${room.number} indisponível nessas datas (${busyByRoom[room.id]}).`);
    if (!valid) return setErr("Confira as datas e os valores.");
    setBusy(true);
    try {
      const input = {
        roomId: room.id,
        guestName,
        guestPhone,
        guestEmail,
        guestId: initial?.guestId ?? null,
        adults,
        children,
        checkInAt: inDate!,
        plannedCheckOutAt: outDate!,
        dailyRateCents: rateCents!,
        discountCents: discountCents!,
        feesCents: feesCents!,
        source,
        notes,
      };
      if (initial) {
        await updateReservation(tenantId, user, initial, input);
        onDone("Reserva alterada.");
      } else {
        await createReservation(tenantId, user, input);
        onDone(`Reserva confirmada: quarto ${room.number}, chegada ${fmtDateTime(inDate)}.`);
      }
    } catch (x) {
      setErr(x instanceof StayError ? x.message : friendlyError(x));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Nome do hóspede"><Input value={guestName} onChange={(e) => setGuestName(e.target.value)} maxLength={120} required /></Field></div>
        <Field label="Telefone / WhatsApp"><Input type="tel" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} maxLength={30} /></Field>
        <Field label="E-mail (opcional)"><Input type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} maxLength={120} /></Field>
        <Field label="Adultos"><Input type="number" min={1} max={50} value={adults} onChange={(e) => setAdults(Math.max(1, Math.floor(Number(e.target.value)) || 1))} /></Field>
        <Field label="Crianças"><Input type="number" min={0} max={50} value={children} onChange={(e) => setChildren(Math.max(0, Math.floor(Number(e.target.value)) || 0))} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Chegada prevista"><Input type="datetime-local" value={checkIn} onChange={(e) => changeCheckIn(e.target.value)} required /></Field>
        <Field label="Diárias (24 h)"><Input type="number" min={1} max={366} value={nights} onChange={(e) => changeNights(Number(e.target.value))} /></Field>
        <Field label="Saída prevista"><Input type="datetime-local" value={checkOut} onChange={(e) => changeCheckOut(e.target.value)} required /></Field>
      </div>
      <Field label="Quarto" hint={datesOk ? "Quartos ocupados ou reservados nessas datas aparecem bloqueados." : "Escolha as datas para ver os quartos livres."}>
        <Select value={roomId} onChange={(e) => { setRoomId(e.target.value); setRateText(""); }} required>
          <option value="">Selecione…</option>
          {list.map((r) => (
            <option key={r.id} value={r.id} disabled={!!busyByRoom[r.id]}>
              Quarto {r.number}{r.name ? ` — ${r.name}` : ""} · {formatCents(r.dailyRateCents)}{busyByRoom[r.id] ? ` (indisponível: ${busyByRoom[r.id]})` : ""}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Valor da diária (R$)"><Input inputMode="decimal" placeholder={room ? centsToInput(room.dailyRateCents) : ""} value={rateText} onChange={(e) => setRateText(e.target.value)} /></Field>
        <Field label="Desconto (R$)"><Input inputMode="decimal" value={discountText} onChange={(e) => setDiscountText(e.target.value)} /></Field>
        <Field label="Taxas (R$)"><Input inputMode="decimal" value={feesText} onChange={(e) => setFeesText(e.target.value)} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Origem da reserva">
          <Select value={source} onChange={(e) => setSource(e.target.value as ReservationSource)}>
            {SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </Field>
        <div className="flex items-end">
          <p className="text-sm text-slate-700">Total previsto: <strong>{planned ? formatCents(planned.total) : "—"}</strong>{planned && datesOk && ` (${countNights(inDate!, outDate!)} diária(s))`}</p>
        </div>
      </div>
      <Field label="Observações internas" hint="Só a equipe vê."><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2} /></Field>
      {err && <Alert>{err}</Alert>}
      <Button type="submit" loading={busy}>{initial ? "Salvar alterações" : "Confirmar reserva"}</Button>
    </form>
  );
}
