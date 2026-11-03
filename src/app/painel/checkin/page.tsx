"use client";

import { Suspense, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { friendlyError, useAuth } from "@/lib/auth/AuthProvider";
import { useRooms } from "@/lib/useRooms";
import { emptyGuest, matchGuest, useGuests } from "@/lib/useGuests";
import { PAY_METHODS, StayError, computePlanned, createStay, type GuestData, type PayMethod } from "@/lib/stays";
import { addNights, countNights, fromLocalInput, toLocalInput } from "@/lib/format";
import { centsToInput, formatCents, parseBRLToCents } from "@/lib/money";
import { GuestFields } from "@/components/GuestFields";
import { QrModal } from "@/components/QrModal";
import { Alert, Button, Card, EmptyState, Field, Input, Select, Spinner, Textarea } from "@/components/ui";

interface CompForm {
  fullName: string;
  document: string;
  birthDate: string;
}

export default function CheckinPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <CheckinForm />
    </Suspense>
  );
}

function CheckinForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, membership } = useAuth();
  const tenantId = membership?.tenantId;
  const allowed = ["owner", "admin", "reception"].includes(membership?.role ?? "");
  const { rooms } = useRooms(allowed ? tenantId : undefined);
  const { guests } = useGuests(allowed ? tenantId : undefined);

  const [now] = useState(() => new Date());
  const [guestId, setGuestId] = useState<string | null>(params.get("guest"));
  const [search, setSearch] = useState("");
  const [guest, setGuest] = useState<GuestData>(emptyGuest);
  const [companions, setCompanions] = useState<CompForm[]>([]);
  const [roomId, setRoomId] = useState(params.get("room") ?? "");
  const [rateText, setRateText] = useState("");
  const [checkIn, setCheckIn] = useState(toLocalInput(now));
  const [nights, setNights] = useState(1);
  const [checkOut, setCheckOut] = useState(toLocalInput(addNights(now, 1)));
  const [discountText, setDiscountText] = useState("");
  const [feesText, setFeesText] = useState("");
  const [notes, setNotes] = useState("");
  const [payText, setPayText] = useState("");
  const [method, setMethod] = useState<PayMethod>("pix");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ token: string; stayId: string; room: string } | null>(null);

  const available = useMemo(() => (rooms ?? []).filter((r) => r.status === "available" && !r.archived), [rooms]);
  const room = available.find((r) => r.id === roomId);
  const selectedGuest = guestId ? (guests ?? []).find((g) => g.id === guestId) : undefined;
  const matches = useMemo(() => (guests ?? []).filter((g) => matchGuest(g, search)).slice(0, 6), [guests, search]);

  if (!allowed) return <Alert>Seu perfil não faz check-in.</Alert>;
  if (!rooms || !guests || !tenantId || !user) return <Spinner />;

  const rateCents = rateText ? parseBRLToCents(rateText) : (room?.dailyRateCents ?? 0);
  const discountCents = discountText ? parseBRLToCents(discountText) : 0;
  const feesCents = feesText ? parseBRLToCents(feesText) : 0;
  const payCents = payText ? parseBRLToCents(payText) : 0;
  const inDate = fromLocalInput(checkIn);
  const outDate = fromLocalInput(checkOut);
  const valid = rateCents !== null && discountCents !== null && feesCents !== null && payCents !== null && inDate && outDate && outDate > inDate;
  const planned = valid ? computePlanned(rateCents!, countNights(inDate!, outDate!), discountCents!, feesCents!) : null;
  const pending = planned ? planned.total - (payCents ?? 0) : null;

  function pickRoom(id: string) {
    setRoomId(id);
    setRateText("");
  }
  function changeNights(n: number) {
    const v = Math.min(365, Math.max(1, Math.floor(n) || 1));
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

  const guestData: GuestData = selectedGuest ?? guest;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!room) return setError("Escolha um quarto disponível.");
    if (!guestData.fullName.trim()) return setError("Informe o responsável pela hospedagem.");
    if (!valid || !planned) return setError("Confira datas e valores.");
    setBusy(true);
    try {
      const r = await createStay({
        tenantId: tenantId!,
        user: user!,
        guestId: guestId ?? undefined,
        guest: guestData,
        companions: companions.filter((c) => c.fullName.trim()),
        roomId: room.id,
        checkInAt: inDate!,
        plannedCheckOutAt: outDate!,
        dailyRateCents: rateCents!,
        discountCents: discountCents!,
        feesCents: feesCents!,
        notes,
        payment: payCents ? { amountCents: payCents, method } : undefined,
      });
      setResult({ token: r.token, stayId: r.stayId, room: room.number });
    } catch (err) {
      setError(err instanceof StayError ? err.message : friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Check-in</h1>
        <p className="text-sm text-slate-600">Pousada 24 horas: a diária conta 24 horas a partir da entrada, em qualquer horário.</p>
      </div>

      {available.length === 0 && (
        <EmptyState
          title="Nenhum quarto disponível"
          text="Todos os quartos estão ocupados, em limpeza, em manutenção ou bloqueados."
          action={<Link href="/painel/quartos/" className="text-sm font-medium text-brand-700 hover:underline">Ver quartos</Link>}
        />
      )}

      <Card className="space-y-4">
        <h2 className="text-base font-semibold">1. Responsável</h2>
        {selectedGuest ? (
          <div className="flex items-center justify-between rounded-lg bg-brand-50 p-3">
            <div>
              <p className="font-medium">{selectedGuest.fullName}</p>
              <p className="text-sm text-slate-600">{selectedGuest.whatsapp || selectedGuest.phone || "Sem telefone"}</p>
            </div>
            <Button type="button" variant="ghost" onClick={() => setGuestId(null)}>Trocar</Button>
          </div>
        ) : (
          <>
            <Field label="Buscar hóspede já cadastrado">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome, telefone ou documento" />
            </Field>
            {search.trim() && (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {matches.length === 0 && <li className="p-3 text-sm text-slate-500">Nenhum hóspede encontrado. Cadastre abaixo.</li>}
                {matches.map((g) => (
                  <li key={g.id}>
                    <button type="button" onClick={() => { setGuestId(g.id); setSearch(""); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                      <span className="font-medium">{g.fullName}</span> <span className="text-slate-500">{g.whatsapp || g.phone}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-sm font-medium text-slate-700">Ou cadastre um novo hóspede:</p>
            <GuestFields value={guest} onChange={setGuest} />
          </>
        )}
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">2. Acompanhantes</h2>
          <Button type="button" variant="secondary" className="px-3 py-1.5" onClick={() => setCompanions([...companions, { fullName: "", document: "", birthDate: "" }])}>
            Adicionar
          </Button>
        </div>
        {companions.length === 0 && <p className="text-sm text-slate-500">Sem acompanhantes.</p>}
        {companions.map((c, idx) => (
          <div key={idx} className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
            <Field label="Nome completo">
              <Input value={c.fullName} maxLength={120} onChange={(e) => setCompanions(companions.map((x, i) => (i === idx ? { ...x, fullName: e.target.value } : x)))} />
            </Field>
            <Field label="Documento">
              <Input value={c.document} maxLength={30} onChange={(e) => setCompanions(companions.map((x, i) => (i === idx ? { ...x, document: e.target.value } : x)))} />
            </Field>
            <Field label="Nascimento">
              <Input type="date" value={c.birthDate} onChange={(e) => setCompanions(companions.map((x, i) => (i === idx ? { ...x, birthDate: e.target.value } : x)))} />
            </Field>
            <Button type="button" variant="ghost" onClick={() => setCompanions(companions.filter((_, i) => i !== idx))}>Remover</Button>
          </div>
        ))}
        {room && companions.length + 1 > room.capacity && (
          <Alert kind="info">Atenção: {companions.length + 1} pessoas, e o quarto comporta {room.capacity}. Confirme se haverá pessoa adicional.</Alert>
        )}
      </Card>

      <Card className="space-y-4">
        <h2 className="text-base font-semibold">3. Quarto e período</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Quarto disponível *">
            <Select value={roomId} onChange={(e) => pickRoom(e.target.value)} required>
              <option value="">Escolher…</option>
              {available.map((r) => (
                <option key={r.id} value={r.id}>{`Quarto ${r.number}${r.name ? ` · ${r.name}` : ""} — ${formatCents(r.dailyRateCents)}`}</option>
              ))}
            </Select>
          </Field>
          <Field label="Valor da diária" hint={room ? "Preenchido com o valor do quarto. Pode alterar." : undefined}>
            <Input inputMode="decimal" value={rateText || (room ? centsToInput(room.dailyRateCents) : "")} onChange={(e) => setRateText(e.target.value)} placeholder="0,00" />
          </Field>
          <Field label="Entrada">
            <Input type="datetime-local" value={checkIn} onChange={(e) => changeCheckIn(e.target.value)} required />
          </Field>
          <Field label="Diárias (24 h cada)">
            <Input type="number" min={1} max={365} value={nights} onChange={(e) => changeNights(Number(e.target.value))} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Saída prevista" hint="Muda sozinha com as diárias; se ajustar a data, as diárias são recalculadas.">
              <Input type="datetime-local" value={checkOut} onChange={(e) => changeCheckOut(e.target.value)} required />
            </Field>
          </div>
          <Field label="Desconto (R$)">
            <Input inputMode="decimal" value={discountText} onChange={(e) => setDiscountText(e.target.value)} placeholder="0,00" />
          </Field>
          <Field label="Taxas adicionais (R$)">
            <Input inputMode="decimal" value={feesText} onChange={(e) => setFeesText(e.target.value)} placeholder="0,00" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Observações">
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
            </Field>
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-base font-semibold">4. Pagamento inicial (opcional)</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Valor recebido agora (R$)">
            <Input inputMode="decimal" value={payText} onChange={(e) => setPayText(e.target.value)} placeholder="0,00" />
          </Field>
          <Field label="Forma de pagamento">
            <Select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
              {PAY_METHODS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </Select>
          </Field>
        </div>
        <dl className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-4">
          <div><dt className="text-slate-500">Diárias</dt><dd className="font-semibold">{valid ? countNights(inDate!, outDate!) : "—"}</dd></div>
          <div><dt className="text-slate-500">Hospedagem</dt><dd className="font-semibold">{planned ? formatCents(planned.lodging) : "—"}</dd></div>
          <div><dt className="text-slate-500">Total previsto</dt><dd className="font-semibold">{planned ? formatCents(planned.total) : "—"}</dd></div>
          <div><dt className="text-slate-500">Saldo a receber</dt><dd className="font-semibold">{pending !== null ? formatCents(pending) : "—"}</dd></div>
        </dl>
        <p className="text-xs text-slate-500">Total previsto é faturamento esperado; só o valor recebido entra no caixa.</p>
      </Card>

      {error && <Alert>{error}</Alert>}
      <Button type="submit" loading={busy} disabled={available.length === 0} className="w-full sm:w-auto">
        Confirmar check-in e gerar QR Code
      </Button>

      {result && (
        <QrModal
          tenantId={tenantId}
          token={result.token}
          title="Check-in realizado"
          subtitle={`Quarto ${result.room} · ${guestData.fullName}`}
          onClose={() => router.replace(`/painel/hospedagem/?id=${result.stayId}`)}
        />
      )}
    </form>
  );
}
