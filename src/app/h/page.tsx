"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { onAuthStateChanged, signInAnonymously, signOut, type User } from "firebase/auth";
import { collection, doc, getDoc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import { sha256Hex } from "@/lib/tokens";
import { applyBrand } from "@/lib/branding";
import { parseCharge, parsePayment, parseStay, chargeLabel, computeAccount, payLabel, type Charge, type Payment, type Stay } from "@/lib/stays";
import { fmtDateTime } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { useNow } from "@/lib/useNow";
import { useMessages } from "@/lib/useStays";
import { PHOTO_CATEGORIES, type Photo, type PhotoCategory } from "@/lib/usePhotos";
import { ChatPanel } from "@/components/ChatPanel";

// Portal do hóspede: separado do painel, sem login de equipe. O QR Code só abre ESTA hospedagem.
export default function GuestPortalPage() {
  return (
    <Suspense fallback={<Center>Carregando…</Center>}>
      <Portal />
    </Suspense>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-center text-slate-600">{children}</main>;
}

interface Pub {
  displayName?: string;
  logoDataUrl?: string;
  phone?: string;
  whatsapp?: string;
  address?: string;
  city?: string;
  state?: string;
  description?: string;
  mapsUrl?: string;
  brandColor?: string;
  checkoutReminderText?: string;
  paymentInfo?: string;
}

type Phase = "boot" | "no-token" | "staff" | "invalid" | "error" | "ready";
const DEFAULT_REMINDER = "Olá! Lembramos que seu horário de checkout está próximo. Esperamos que tenha aproveitado sua estadia!";

function Portal() {
  const tenantId = useSearchParams().get("t");
  const [phase, setPhase] = useState<Phase>("boot");
  const [user, setUser] = useState<User | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [stayId, setStayId] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);

  // 1) Token: do fragmento da URL (e guardado só nesta aba, para recarregar a página).
  useEffect(() => {
    if (!tenantId) return;
    let token = window.location.hash.replace(/^#/, "");
    const key = `pg-token:${tenantId}`;
    try {
      if (token) {
        sessionStorage.setItem(key, token);
        history.replaceState(null, "", window.location.pathname + window.location.search); // tira o token da barra
      } else token = sessionStorage.getItem(key) ?? "";
    } catch {
      /* sem sessionStorage: segue só com o fragmento */
    }
    if (!token) {
      queueMicrotask(() => setPhase("no-token"));
      return;
    }
    sha256Hex(token).then(setHash);
  }, [tenantId]);

  // 2) Login anônimo (sem dados pessoais) e abertura da sessão da hospedagem.
  useEffect(() => {
    if (!tenantId || !hash) return;
    const { auth, db } = getFirebase();
    let cancelled = false;
    const off = onAuthStateChanged(auth, async (u) => {
      if (cancelled) return;
      try {
        if (!u) {
          await signInAnonymously(auth);
          return;
        }
        if (!u.isAnonymous) {
          setUser(u);
          return setPhase("staff");
        }
        setUser(u);
        const accRef = doc(db, `tenants/${tenantId}/stayAccess/${hash}`);
        const acc = await getDoc(accRef);
        if (!acc.exists() || acc.data().status !== "active") return setPhase("invalid");
        const sess = doc(db, `tenants/${tenantId}/stayAccess/${hash}/sessions/${u.uid}`);
        if (!(await getDoc(sess)).exists()) await setDoc(sess, { createdAt: serverTimestamp() });
        setStayId(acc.data().stayId as string);
        setPhase("ready");
      } catch {
        if (!cancelled) setPhase("error");
      }
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [tenantId, hash]);

  // Acesso encerrado (checkout ou revogação): derruba a tela na hora, inclusive com a página aberta.
  useEffect(() => {
    if (phase !== "ready" || !tenantId || !hash) return;
    const { db } = getFirebase();
    return onSnapshot(
      doc(db, `tenants/${tenantId}/stayAccess/${hash}`),
      (s) => s.data()?.status !== "active" && setClosed(true),
      () => setClosed(true),
    );
  }, [phase, tenantId, hash]);

  if (!tenantId) return <Center>Escaneie o QR Code entregue pela recepção para abrir sua hospedagem.</Center>;
  if (phase === "boot") return <Center>Abrindo sua hospedagem…</Center>;
  if (phase === "no-token") return <Center>Escaneie o QR Code entregue pela recepção para abrir sua hospedagem.</Center>;
  if (phase === "staff")
    return (
      <Center>
        <div className="max-w-sm space-y-3">
          <p>Este navegador está com a conta da equipe da pousada. Esta página é exclusiva para hóspedes.</p>
          <button className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white" onClick={() => signOut(getFirebase().auth)}>
            Sair da conta da equipe e abrir como hóspede
          </button>
        </div>
      </Center>
    );
  if (phase === "invalid" || closed) return <Closed />;
  if (phase === "error") return <Center>Não foi possível abrir agora. Verifique sua internet e tente de novo, ou procure a recepção.</Center>;
  if (!tenantId || !stayId || !user) return <Center>Carregando…</Center>;
  return <Ready tenantId={tenantId} stayId={stayId} uid={user.uid} onClosed={() => setClosed(true)} />;
}

function Closed() {
  return (
    <Center>
      <div className="max-w-sm space-y-2">
        <h1 className="text-lg font-semibold text-slate-800">Acesso encerrado</h1>
        <p>Esta hospedagem foi encerrada ou o QR Code deixou de valer. Obrigado pela visita! Para qualquer dúvida, fale com a pousada.</p>
      </div>
    </Center>
  );
}

function Ready({ tenantId, stayId, uid, onClosed }: { tenantId: string; stayId: string; uid: string; onClosed: () => void }) {
  const [pub, setPub] = useState<Pub>({});
  const [stay, setStay] = useState<Stay | null>(null);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [tab, setTab] = useState<"inicio" | "conta" | "chat" | "fotos">("inicio");
  const { messages } = useMessages(tenantId, stayId);

  useEffect(() => {
    const { db } = getFirebase();
    const base = `tenants/${tenantId}`;
    const denied = () => onClosed();
    const u = [
      onSnapshot(doc(db, `${base}/publicInfo/main`), (s) => {
        const d = (s.data() as Pub) ?? {};
        setPub(d);
        applyBrand(d.brandColor);
      }),
      onSnapshot(doc(db, `${base}/stays/${stayId}`), (s) => s.exists() && setStay(parseStay(s.id, s.data())), denied),
      onSnapshot(collection(db, `${base}/stays/${stayId}/charges`), (s) => setCharges(s.docs.map((d) => parseCharge(d.id, d.data())).sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))), denied),
      onSnapshot(collection(db, `${base}/stays/${stayId}/payments`), (s) => setPayments(s.docs.map((d) => parsePayment(d.id, d.data())).sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))), denied),
      onSnapshot(collection(db, `${base}/photos`), (s) =>
        setPhotos(
          s.docs
            .map((d) => ({ id: d.id, category: d.data().category as PhotoCategory, roomId: d.data().roomId as string | undefined, caption: (d.data().caption as string) ?? "", dataUrl: d.data().dataUrl as string, createdMs: d.data().createdAt?.toMillis?.() ?? 0 }))
            .sort((a, b) => a.createdMs - b.createdMs),
        ),
      ),
    ];
    return () => {
      u.forEach((f) => f());
      applyBrand(null);
    };
  }, [tenantId, stayId, onClosed]);

  const unread = (messages ?? []).filter((m) => m.sender === "staff" && !m.readByGuestAt).length;
  const acc = useMemo(() => (stay ? computeAccount(stay, charges, payments) : null), [stay, charges, payments]);

  if (!stay || !acc) return <Center>Carregando…</Center>;
  const tabs = [
    { id: "inicio", label: "Início" },
    { id: "conta", label: "Minha conta" },
    { id: "chat", label: unread ? `Conversa (${unread})` : "Conversa" },
    { id: "fotos", label: "Fotos" },
  ] as const;

  return (
    <div className="min-h-screen bg-slate-50 pb-10">
      <header className="bg-brand-700 px-4 py-5 text-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          {pub.logoDataUrl && <img src={pub.logoDataUrl} alt="" className="h-12 max-w-32 rounded bg-white/95 object-contain p-1" />}
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{pub.displayName || "Pousada"}</p>
            <p className="truncate text-sm text-white/85">Olá, {stay.guestName.split(" ")[0]}! Quarto {stay.roomNumber}</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 px-4 pt-4">
        <CheckoutBanner stay={stay} text={pub.checkoutReminderText || DEFAULT_REMINDER} />

        <nav className="flex gap-1 overflow-x-auto rounded-xl bg-white p-1 shadow-sm" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${tab === t.id ? "bg-brand-700 text-white" : "text-slate-700"}`}>
              {t.label}
            </button>
          ))}
        </nav>

        {tab === "inicio" && (
          <section className="space-y-4">
            <Box title="Minha hospedagem">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Cell l="Responsável" v={stay.guestName} />
                <Cell l="Quarto" v={stay.roomNumber} />
                <Cell l="Check-in" v={fmtDateTime(stay.checkInAt)} />
                <Cell l="Check-out previsto" v={fmtDateTime(stay.plannedCheckOutAt)} />
                <Cell l="Diárias" v={`${stay.nights}`} />
                <Cell l="Valor da diária" v={formatCents(stay.dailyRateCents)} />
              </dl>
            </Box>
            {(pub.description || pub.address || pub.phone) && (
              <Box title="Informações úteis">
                {pub.description && <p className="mb-3 whitespace-pre-wrap text-sm text-slate-700">{pub.description}</p>}
                <p className="text-sm text-slate-600">{[pub.address, pub.city, pub.state].filter(Boolean).join(", ")}</p>
                <p className="text-sm text-slate-600">{[pub.phone, pub.whatsapp && `WhatsApp ${pub.whatsapp}`].filter(Boolean).join(" · ")}</p>
                {pub.address && (
                  <iframe title="Mapa" loading="lazy" referrerPolicy="no-referrer" className="mt-3 h-48 w-full rounded-lg border border-slate-200"
                    src={`https://www.google.com/maps?q=${encodeURIComponent([pub.address, pub.city, pub.state].filter(Boolean).join(", "))}&output=embed`} />
                )}
                {pub.mapsUrl && /^https:\/\//.test(pub.mapsUrl) && (
                  <a href={pub.mapsUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-medium text-brand-700 underline">Abrir no Google Maps</a>
                )}
              </Box>
            )}
            <NotificationToggle stay={stay} text={pub.checkoutReminderText || DEFAULT_REMINDER} />
          </section>
        )}

        {tab === "conta" && (
          <section className="space-y-4">
            <Box title="Resumo">
              <dl className="space-y-1.5 text-sm">
                <Line l="Hospedagem" v={formatCents(acc.lodgingCents)} />
                {acc.feesCents > 0 && <Line l="Taxas" v={formatCents(acc.feesCents)} />}
                <Line l="Consumos e serviços" v={formatCents(acc.chargesCents)} />
                {acc.discountCents > 0 && <Line l="Descontos" v={`− ${formatCents(acc.discountCents)}`} />}
                <Line l="Total lançado" v={formatCents(acc.totalCents)} strong />
                <Line l="Pagamentos recebidos" v={formatCents(acc.paidCents)} />
                <Line l="Saldo pendente" v={formatCents(Math.max(0, acc.pendingCents))} strong />
              </dl>
              {pub.paymentInfo && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><strong>Como pagar:</strong> {pub.paymentInfo}</p>}
              <p className="mt-2 text-xs text-slate-500">Valores atualizados em tempo real. O pagamento é confirmado pela recepção.</p>
            </Box>
            <Box title="Consumos e serviços">
              {charges.filter((c) => c.status === "active").length === 0 ? <p className="text-sm text-slate-500">Nenhum lançamento.</p> : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {charges.filter((c) => c.status === "active").map((c) => (
                    <li key={c.id} className="flex justify-between gap-2 py-2"><span>{c.description} <span className="text-slate-500">· {chargeLabel(c.category)} · {c.quantity} × {formatCents(c.unitCents)}</span></span><span className="font-medium">{formatCents(c.totalCents)}</span></li>
                  ))}
                </ul>
              )}
            </Box>
            <Box title="Pagamentos">
              {payments.length === 0 ? <p className="text-sm text-slate-500">Nenhum pagamento registrado.</p> : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {payments.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2 py-2"><span>{fmtDateTime(p.createdAt)} · {p.kind === "refund" ? "Estorno" : "Pagamento"} · {payLabel(p.method)}</span><span className="font-medium">{p.kind === "refund" ? "− " : ""}{formatCents(p.amountCents)}</span></li>
                  ))}
                </ul>
              )}
            </Box>
          </section>
        )}

        {tab === "chat" && (
          <Box title="Conversa com a recepção">
            <ChatPanel tenantId={tenantId} stayId={stayId} as="guest" uid={uid} />
          </Box>
        )}

        {tab === "fotos" && (
          <section className="space-y-4">
            {photos.length === 0 && <Box title="Fotos"><p className="text-sm text-slate-500">A pousada ainda não publicou fotos.</p></Box>}
            {PHOTO_CATEGORIES.map((c) => {
              const list = photos.filter((p) => p.category === c.id && (c.id !== "quarto" || p.roomId === stay.roomId));
              if (!list.length) return null;
              return (
                <Box key={c.id} title={c.id === "quarto" ? "Seu quarto" : c.label}>
                  <ul className="grid grid-cols-2 gap-2">
                    {list.map((p) => (
                      <li key={p.id}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.dataUrl} alt={p.caption || c.label} loading="lazy" className="aspect-[4/3] w-full rounded-lg object-cover" />
                        {p.caption && <p className="mt-1 text-xs text-slate-600">{p.caption}</p>}
                      </li>
                    ))}
                  </ul>
                </Box>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-base font-semibold text-slate-900">{title}</h2>
      {children}
    </div>
  );
}
const Cell = ({ l, v }: { l: string; v: string }) => (<div><dt className="text-slate-500">{l}</dt><dd className="font-medium">{v}</dd></div>);
const Line = ({ l, v, strong }: { l: string; v: string; strong?: boolean }) => (<div className={`flex justify-between ${strong ? "border-t border-slate-100 pt-1.5 font-semibold" : ""}`}><dt>{l}</dt><dd>{v}</dd></div>);

/** Avisos de 2 h e 30 min antes da saída, calculados do checkout previsto atual (some se for alterado). */
function useReminderLevel(stay: Stay): "none" | "h2" | "m30" | "late" {
  const now = useNow();
  const left = stay.plannedCheckOutAt.getTime() - now;
  if (left <= 0) return "late";
  if (left <= 30 * 60000) return "m30";
  if (left <= 2 * 3600000) return "h2";
  return "none";
}

function CheckoutBanner({ stay, text }: { stay: Stay; text: string }) {
  const level = useReminderLevel(stay);
  if (level === "none") return null;
  const label = level === "h2" ? "Faltam menos de 2 horas para o checkout" : level === "m30" ? "Faltam menos de 30 minutos para o checkout" : "O horário previsto de checkout já passou";
  return (
    <div role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-600/20">
      <p className="font-semibold">{label} ({fmtDateTime(stay.plannedCheckOutAt)})</p>
      <p className="mt-1">{text}</p>
    </div>
  );
}

/** Aviso do sistema neste aparelho, apenas enquanto a página estiver aberta (sem servidor de push no plano gratuito). */
function NotificationToggle({ stay, text }: { stay: Stay; text: string }) {
  const level = useReminderLevel(stay);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission));
  const ask = useCallback(async () => setPerm(await Notification.requestPermission()), []);

  useEffect(() => {
    if (perm !== "granted" || level === "none" || level === "late") return;
    const key = `pg-notified:${stay.id}:${stay.plannedCheckOutAt.getTime()}:${level}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
      new Notification(level === "h2" ? "Checkout em 2 horas" : "Checkout em 30 minutos", { body: text });
    } catch {
      /* ignora */
    }
  }, [perm, level, stay.id, stay.plannedCheckOutAt, text]);

  if (perm === "unsupported" || perm === "denied") return null;
  return (
    <Box title="Avisos de checkout">
      <p className="text-sm text-slate-600">Avisaremos aqui no portal 2 horas e 30 minutos antes do checkout.</p>
      {perm === "default" ? (
        <button onClick={ask} className="mt-2 rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white">Receber aviso neste aparelho</button>
      ) : (
        <p className="mt-2 text-sm text-emerald-700">Avisos ativados neste aparelho (funcionam com esta página aberta).</p>
      )}
    </Box>
  );
}
