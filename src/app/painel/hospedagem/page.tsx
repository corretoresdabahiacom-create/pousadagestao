"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { doc, onSnapshot } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import { friendlyError, useAuth } from "@/lib/auth/AuthProvider";
import { useStay } from "@/lib/useStays";
import {
  CHARGE_CATEGORIES,
  PAY_METHODS,
  StayError,
  addCharge,
  addPayment,
  cancelCharge,
  chargeLabel,
  closeStay,
  computeAccount,
  extendStay,
  payLabel,
  reissueAccess,
  reminderTimes,
  revokeAccess,
  type PayMethod,
  type Stay,
} from "@/lib/stays";
import { fmtDateTime, fromLocalInput, newId, toLocalInput } from "@/lib/format";
import { formatCents, parseBRLToCents } from "@/lib/money";
import { useNow } from "@/lib/useNow";
import { ChatPanel } from "@/components/ChatPanel";
import { QrModal } from "@/components/QrModal";
import { Alert, Badge, Button, Card, Field, Input, Modal, Select, Spinner } from "@/components/ui";

export default function StayPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <StayDetail />
    </Suspense>
  );
}

function StayDetail() {
  const id = useSearchParams().get("id");
  const { user, membership } = useAuth();
  const tenantId = membership?.tenantId;
  const role = membership?.role;
  const canAct = role === "owner" || role === "admin" || role === "reception";
  const allowed = canAct || role === "finance";
  const { stay, charges, payments, companions, error } = useStay(allowed ? tenantId : undefined, id);
  const [access, setAccess] = useState<string | null>(null);
  const [modal, setModal] = useState<"" | "charge" | "pay" | "refund" | "extend" | "checkout">("");
  const [qr, setQr] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState<"" | "revoke" | "reissue">("");
  const now = useNow();

  const hash = stay?.accessHash;
  useEffect(() => {
    if (!tenantId || !hash) return;
    const { db } = getFirebase();
    return onSnapshot(doc(db, `tenants/${tenantId}/stayAccess/${hash}`), (s) => setAccess(s.exists() ? (s.data().status as string) : "missing"), () => setAccess("missing"));
  }, [tenantId, hash]);

  if (!allowed) return <Alert>Seu perfil não tem acesso às hospedagens.</Alert>;
  if (!id) return <Alert>Hospedagem não informada.</Alert>;
  if (error) return <Alert>{error}</Alert>;
  if (stay === undefined || !tenantId || !user) return <Spinner />;
  if (stay === null) return <Alert>Hospedagem não encontrada.</Alert>;

  const acc = computeAccount(stay, charges, payments);
  const active = stay.status === "active";
  const reminders = reminderTimes(stay.plannedCheckOutAt);

  async function run(fn: () => Promise<void>, ok: string) {
    setErr("");
    setNotice("");
    try {
      await fn();
      setNotice(ok);
    } catch (e) {
      setErr(e instanceof StayError ? e.message : friendlyError(e));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/painel/hospedagens/" className="text-sm text-brand-700 hover:underline">← Hospedagens</Link>
          <h1 className="mt-1 text-2xl font-bold">Quarto {stay.roomNumber} · {stay.guestName}</h1>
          <p className="text-sm text-slate-600">
            <Badge className={active ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : "bg-slate-100 text-slate-700 ring-slate-500/20"}>
              {active ? "Hospedado" : "Encerrada"}
            </Badge>{" "}
            {stay.guestPhone}
          </p>
        </div>
        {canAct && active && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setModal("extend")}>Prorrogar</Button>
            <Button onClick={() => setModal("checkout")}>Fazer checkout</Button>
          </div>
        )}
        {!active && (
          <Link href={`/painel/comprovante/?id=${stay.id}`} className="inline-flex rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50">
            Comprovante (PDF)
          </Link>
        )}
      </div>

      {notice && <Alert kind="success">{notice}</Alert>}
      {err && <Alert>{err}</Alert>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-base font-semibold">Hospedagem</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Item l="Entrada" v={fmtDateTime(stay.checkInAt)} />
            <Item l={active ? "Saída prevista" : "Saída realizada"} v={fmtDateTime(active ? stay.plannedCheckOutAt : stay.checkedOutAt)} />
            <Item l="Diárias" v={`${stay.nights} × ${formatCents(stay.dailyRateCents)}`} />
            <Item l="Acompanhantes" v={String(stay.companionsCount)} />
          </dl>
          {companions.length > 0 && (
            <ul className="mt-3 list-inside list-disc text-sm text-slate-600">
              {companions.map((c) => <li key={c.id}>{c.fullName}</li>)}
            </ul>
          )}
          {stay.notes && <p className="mt-3 rounded bg-slate-50 p-2 text-sm text-slate-600">{stay.notes}</p>}
          {active && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Avisos de checkout (no portal do hóspede)</p>
              <ul className="mt-1 text-sm text-slate-600">
                {reminders.map((r) => (
                  <li key={r.label}>{r.label}: {fmtDateTime(r.at)} {r.at.getTime() < now && <span className="text-slate-400">(já passou — não será enviado)</span>}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold">Conta</h2>
          <dl className="space-y-1.5 text-sm">
            <Row l="Hospedagem" v={formatCents(acc.lodgingCents)} />
            <Row l="Taxas" v={formatCents(acc.feesCents)} />
            <Row l="Consumos e serviços" v={formatCents(acc.chargesCents)} />
            <Row l="Desconto" v={`− ${formatCents(acc.discountCents)}`} />
            <Row l="Total lançado" v={formatCents(acc.totalCents)} strong />
            <Row l="Recebido" v={formatCents(acc.paidCents)} />
            <Row l="Saldo pendente" v={formatCents(Math.max(0, acc.pendingCents))} strong warn={acc.pendingCents > 0} />
            {acc.pendingCents < 0 && <Row l="Crédito do hóspede" v={formatCents(-acc.pendingCents)} />}
          </dl>
          {canAct && active && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setModal("charge")}>Lançar consumo</Button>
              <Button variant="secondary" onClick={() => setModal("pay")}>Registrar pagamento</Button>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 text-base font-semibold">Consumos e serviços</h2>
        {charges.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum lançamento.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {charges.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className={c.status === "cancelled" ? "text-slate-400 line-through" : ""}>
                  <p className="font-medium">{c.description} <span className="font-normal text-slate-500">· {chargeLabel(c.category)}</span></p>
                  <p className="text-xs text-slate-500">{c.quantity} × {formatCents(c.unitCents)} · {fmtDateTime(c.createdAt)}</p>
                  {c.status === "cancelled" && <p className="text-xs no-underline">Cancelado: {c.cancelReason}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{formatCents(c.totalCents)}</span>
                  {canAct && active && c.status === "active" && (
                    <CancelCharge onConfirm={(reason) => run(() => cancelCharge(tenantId, user, stay.id, c.id, reason), "Lançamento cancelado.")} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Pagamentos</h2>
          {canAct && active && payments.some((p) => p.kind === "payment") && (
            <Button variant="ghost" className="px-3 py-1.5" onClick={() => setModal("refund")}>Registrar estorno</Button>
          )}
        </div>
        {payments.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum pagamento registrado.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="font-medium">{p.kind === "refund" ? "Estorno" : "Pagamento"} · {payLabel(p.method)}</p>
                  <p className="text-xs text-slate-500">{fmtDateTime(p.createdAt)} {p.note && `· ${p.note}`}</p>
                </div>
                <span className={`font-semibold ${p.kind === "refund" ? "text-red-700" : ""}`}>{p.kind === "refund" ? "− " : ""}{formatCents(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {active && (
        <Card>
          <h2 className="mb-2 text-base font-semibold">QR Code do portal do hóspede</h2>
          <p className="mb-3 text-sm text-slate-600">
            Situação:{" "}
            {access === "active" ? <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-600/20">Ativo</Badge> : access === null ? "…" : <Badge className="bg-red-50 text-red-700 ring-red-600/20">Revogado</Badge>}
          </p>
          {canAct && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setConfirm("reissue")}>Reemitir QR Code</Button>
              {access === "active" && <Button variant="danger" onClick={() => setConfirm("revoke")}>Revogar acesso</Button>}
            </div>
          )}
          {confirm && (
            <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              {confirm === "revoke"
                ? "O hóspede perde o acesso ao portal imediatamente, mesmo com a página aberta."
                : "Será gerado um novo QR Code e o anterior deixará de valer imediatamente."}
              <div className="mt-2 flex gap-2">
                <Button
                  variant="danger"
                  onClick={() => {
                    const c = confirm;
                    setConfirm("");
                    if (c === "revoke") void run(() => revokeAccess(tenantId, user, stay), "Acesso revogado.");
                    else void run(async () => setQr(await reissueAccess(tenantId, user, stay)), "Novo QR Code gerado.");
                  }}
                >
                  Confirmar
                </Button>
                <Button variant="secondary" onClick={() => setConfirm("")}>Cancelar</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <Card>
        <h2 className="mb-3 text-base font-semibold">Conversa com o hóspede</h2>
        <ChatPanel tenantId={tenantId} stayId={stay.id} as="staff" uid={user.uid} disabled={!active || !canAct} />
      </Card>

      {modal === "charge" && <ChargeModal onClose={() => setModal("")} onSubmit={(c, key) => run(() => addCharge(tenantId, user, stay.id, c, key), "Lançamento registrado.")} />}
      {(modal === "pay" || modal === "refund") && (
        <PayModal
          kind={modal === "refund" ? "refund" : "payment"}
          pending={Math.max(0, acc.pendingCents)}
          onClose={() => setModal("")}
          onSubmit={(p, key) => run(() => addPayment(tenantId, user, stay, p, key), modal === "refund" ? "Estorno registrado." : "Pagamento registrado.")}
        />
      )}
      {modal === "extend" && (
        <ExtendModal stay={stay} onClose={() => setModal("")} onSubmit={(d) => run(() => extendStay(tenantId, user, stay, d), "Hospedagem prorrogada. Os avisos foram recalculados.")} />
      )}
      {modal === "checkout" && (
        <CheckoutModal
          stay={stay}
          pending={acc.pendingCents}
          total={acc.totalCents}
          onClose={() => setModal("")}
          onDone={() => {
            setModal("");
            setNotice("Checkout concluído. O QR Code foi revogado e o quarto foi para a limpeza.");
          }}
          tenantId={tenantId}
          user={user}
        />
      )}
      {qr && <QrModal tenantId={tenantId} token={qr} title="Novo QR Code" subtitle={`Quarto ${stay.roomNumber} · ${stay.guestName}`} onClose={() => setQr(null)} />}
    </div>
  );
}

function Item({ l, v }: { l: string; v: string }) {
  return (
    <div>
      <dt className="text-slate-500">{l}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
function Row({ l, v, strong, warn }: { l: string; v: string; strong?: boolean; warn?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "border-t border-slate-100 pt-1.5 font-semibold" : ""} ${warn ? "text-red-700" : ""}`}>
      <dt>{l}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function CancelCharge({ onConfirm }: { onConfirm: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) return <Button variant="ghost" className="px-2 py-1" onClick={() => setOpen(true)}>Cancelar</Button>;
  return (
    <span className="flex items-center gap-1">
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Justificativa" className="!w-40 !py-1" aria-label="Justificativa" />
      <Button variant="danger" className="px-2 py-1" disabled={!reason.trim()} onClick={() => { onConfirm(reason); setOpen(false); }}>OK</Button>
    </span>
  );
}

function ChargeModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (c: { description: string; category: string; quantity: number; unitCents: number; notes: string }, key: string) => Promise<void> }) {
  const [d, setD] = useState("");
  const [cat, setCat] = useState("bebidas");
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [key] = useState(() => newId());
  const [busy, setBusy] = useState(false);
  const cents = price ? parseBRLToCents(price) : null;
  async function go(e: FormEvent) {
    e.preventDefault();
    if (cents === null) return;
    setBusy(true);
    await onSubmit({ description: d, category: cat, quantity: qty, unitCents: cents, notes }, key);
    setBusy(false);
    onClose();
  }
  return (
    <Modal title="Lançar consumo" onClose={onClose}>
      <form onSubmit={go} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Descrição *"><Input value={d} onChange={(e) => setD(e.target.value)} required maxLength={120} /></Field></div>
        <Field label="Categoria">
          <Select value={cat} onChange={(e) => setCat(e.target.value)}>{CHARGE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>
        </Field>
        <Field label="Quantidade"><Input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value)) || 1))} /></Field>
        <Field label="Valor unitário (R$) *" error={price && cents === null ? "Valor inválido" : undefined}><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required placeholder="0,00" /></Field>
        <Field label="Total"><Input readOnly value={cents !== null ? formatCents(cents * qty) : "—"} /></Field>
        <div className="sm:col-span-2"><Field label="Observações"><Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} /></Field></div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy} disabled={cents === null || !d.trim()}>Lançar</Button>
        </div>
      </form>
    </Modal>
  );
}

function PayModal({ kind, pending, onClose, onSubmit }: { kind: "payment" | "refund"; pending: number; onClose: () => void; onSubmit: (p: { amountCents: number; method: PayMethod; kind: "payment" | "refund"; note: string }, key: string) => Promise<void> }) {
  const [amount, setAmount] = useState(kind === "payment" && pending > 0 ? (pending / 100).toFixed(2).replace(".", ",") : "");
  const [method, setMethod] = useState<PayMethod>("pix");
  const [note, setNote] = useState("");
  const [key] = useState(() => newId()); // mesma chave em reenvios: não duplica
  const [busy, setBusy] = useState(false);
  const cents = amount ? parseBRLToCents(amount) : null;
  async function go(e: FormEvent) {
    e.preventDefault();
    if (!cents) return;
    setBusy(true);
    await onSubmit({ amountCents: cents, method, kind, note }, key);
    setBusy(false);
    onClose();
  }
  return (
    <Modal title={kind === "refund" ? "Registrar estorno" : "Registrar pagamento"} onClose={onClose}>
      <form onSubmit={go} className="grid gap-4 sm:grid-cols-2">
        <Field label="Valor (R$) *" error={amount && !cents ? "Valor inválido" : undefined}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
        <Field label="Forma"><Select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>{PAY_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select></Field>
        <div className="sm:col-span-2"><Field label="Observação"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} /></Field></div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy} disabled={!cents}>Confirmar</Button>
        </div>
      </form>
    </Modal>
  );
}

function ExtendModal({ stay, onClose, onSubmit }: { stay: Stay; onClose: () => void; onSubmit: (d: Date) => Promise<void> }) {
  const [v, setV] = useState(toLocalInput(stay.plannedCheckOutAt));
  const [busy, setBusy] = useState(false);
  const d = fromLocalInput(v);
  return (
    <Modal title="Alterar saída prevista" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Nova saída prevista" hint="As diárias e o total são recalculados e os avisos de checkout são reagendados.">
          <Input type="datetime-local" value={v} onChange={(e) => setV(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} disabled={!d || d <= stay.checkInAt} onClick={async () => { setBusy(true); await onSubmit(d!); setBusy(false); onClose(); }}>Salvar</Button>
        </div>
      </div>
    </Modal>
  );
}

function CheckoutModal({ stay, pending, total, onClose, onDone, tenantId, user }: { stay: Stay; pending: number; total: number; onClose: () => void; onDone: () => void; tenantId: string; user: NonNullable<ReturnType<typeof useAuth>["user"]> }) {
  const [amount, setAmount] = useState(pending > 0 ? (pending / 100).toFixed(2).replace(".", ",") : "");
  const [method, setMethod] = useState<PayMethod>("pix");
  const [due, setDue] = useState(() => toLocalInput(new Date(Date.now() + 7 * 86400000)).slice(0, 10));
  const [key] = useState(() => newId());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pay = amount ? parseBRLToCents(amount) : 0;
  const left = pay === null ? null : pending - pay;

  async function go() {
    if (pay === null || left === null) return setErr("Valor inválido.");
    setBusy(true);
    setErr("");
    try {
      await closeStay({
        tenantId,
        user,
        stay,
        payment: pay > 0 ? { amountCents: pay, method, key } : undefined,
        receivableDueDate: left > 0 ? new Date(`${due}T12:00:00`) : undefined,
      });
      onDone();
    } catch (e) {
      setErr(e instanceof StayError ? e.message : friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Checkout" onClose={onClose}>
      <div className="space-y-4">
        <dl className="space-y-1.5 rounded-lg bg-slate-50 p-3 text-sm">
          <Row l="Total da conta" v={formatCents(total)} />
          <Row l="Já recebido" v={formatCents(total - pending)} />
          <Row l="Saldo a receber agora" v={formatCents(Math.max(0, pending))} strong />
        </dl>
        {pending > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Recebido agora (R$)"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field label="Forma"><Select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>{PAY_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select></Field>
            {left !== null && left > 0 && (
              <div className="sm:col-span-2">
                <Alert kind="info">Ficará {formatCents(left)} sem receber. Será criada uma conta a receber.</Alert>
                <Field label="Vencimento do saldo"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
              </div>
            )}
          </div>
        )}
        <p className="text-xs text-slate-600">
          Ao confirmar: a conta é fechada, o QR Code é revogado na hora, os avisos futuros deixam de valer e o quarto vai para a limpeza.
          A operação é única: se algo falhar, nada é gravado.
        </p>
        {err && <Alert>{err}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} onClick={go}>Confirmar checkout</Button>
        </div>
      </div>
    </Modal>
  );
}
