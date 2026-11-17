"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import { friendlyError, useAuth } from "@/lib/auth/AuthProvider";
import { useStay } from "@/lib/useStays";
import { type GuestData } from "@/lib/stays";
import { usePublicInfo } from "@/lib/usePublicInfo";
import { fmtDateTime } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { Alert, Button, Spinner } from "@/components/ui";

export default function GuestCardPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <GuestCard />
    </Suspense>
  );
}

/** "1990-05-03" → "03/05/1990"; outros formatos aparecem como foram digitados. */
function br(d?: string): string {
  if (!d) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

/** Linha da ficha: rótulo pequeno e valor (ou espaço em branco para preencher à mão). */
function Row({ l, v }: { l: string; v?: string }) {
  return (
    <div className="border-b border-slate-200 py-1.5">
      <dt className="text-xs text-slate-500">{l}</dt>
      <dd className="min-h-5 font-medium">{v || "\u00a0"}</dd>
    </div>
  );
}

function GuestCard() {
  const id = useSearchParams().get("id");
  const { membership } = useAuth();
  const tenantId = membership?.tenantId;
  const allowed = ["owner", "admin", "reception"].includes(membership?.role ?? "");
  const { stay, companions, error } = useStay(allowed ? tenantId : undefined, id);
  const pub = usePublicInfo(allowed ? tenantId : undefined);
  const [guest, setGuest] = useState<Partial<GuestData> | null>(null);
  const [gErr, setGErr] = useState("");
  const guestId = stay?.guestId;

  useEffect(() => {
    if (!tenantId || !guestId) return;
    const { db } = getFirebase();
    getDoc(doc(db, `tenants/${tenantId}/guests/${guestId}`))
      .then((s) => setGuest((s.data() as Partial<GuestData>) ?? {}))
      .catch((e) => setGErr(friendlyError(e)));
  }, [tenantId, guestId]);

  if (!allowed) return <Alert>Seu perfil não tem acesso aos dados dos hóspedes.</Alert>;
  if (!id) return <Alert>Hospedagem não informada.</Alert>;
  if (error) return <Alert>{error}</Alert>;
  if (stay === null) return <Alert>Hospedagem não encontrada.</Alert>;
  if (!stay) return <Spinner />;

  const g = guest ?? {};

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={`/painel/hospedagem/?id=${stay.id}`} className="text-sm text-brand-700 hover:underline">← Voltar à hospedagem</Link>
        <Button onClick={() => window.print()}>Imprimir / salvar em PDF</Button>
      </div>
      {gErr && <Alert>{gErr}</Alert>}
      <article className="rounded-xl border border-slate-200 bg-white p-8 text-sm print:border-0 print:p-0">
        <header className="mb-5 flex items-center gap-4 border-b border-slate-300 pb-4">
          {pub.logoDataUrl && <img src={pub.logoDataUrl} alt="" className="h-14 max-w-40 object-contain" />}
          <div>
            <h1 className="text-lg font-bold">{pub.displayName || "Pousada"}</h1>
            <p className="text-slate-600">{[pub.address, pub.city, pub.state].filter(Boolean).join(", ")}</p>
            <p className="text-slate-600">{[pub.phone, pub.whatsapp].filter(Boolean).join(" · ")}</p>
          </div>
        </header>

        <h2 className="mb-3 text-base font-semibold">Ficha de registro de hóspede</h2>

        <h3 className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Hóspede responsável</h3>
        <dl className="grid grid-cols-2 gap-x-6">
          <div className="col-span-2"><Row l="Nome completo" v={g.fullName || stay.guestName} /></div>
          <Row l="Documento (CPF / RG / passaporte)" v={g.document} />
          <Row l="Data de nascimento" v={br(g.birthDate)} />
          <Row l="Telefone / WhatsApp" v={[g.whatsapp, g.phone].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(" · ") || stay.guestPhone} />
          <Row l="E-mail" v={g.email} />
        </dl>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Contato de emergência</h3>
        <dl className="grid grid-cols-3 gap-x-6">
          <Row l="Nome" v={g.emergencyName} />
          <Row l="Telefone" v={g.emergencyPhone} />
          <Row l="Parentesco" v={g.emergencyRelation} />
        </dl>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Acompanhantes ({companions.length})</h3>
        {companions.length === 0 ? <p className="py-1.5 text-slate-500">Nenhum acompanhante.</p> : (
          <table className="w-full">
            <thead><tr className="border-b border-slate-300 text-left text-xs text-slate-500"><th className="py-1 font-medium">Nome</th><th className="font-medium">Documento</th><th className="font-medium">Nascimento</th></tr></thead>
            <tbody>{companions.map((c) => (
              <tr key={c.id} className="border-b border-slate-200"><td className="py-1.5">{c.fullName}</td><td>{c.document}</td><td>{br(c.birthDate)}</td></tr>
            ))}</tbody>
          </table>
        )}

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Hospedagem</h3>
        <dl className="grid grid-cols-2 gap-x-6">
          <Row l="Quarto" v={stay.roomNumber} />
          <Row l="Diárias" v={`${stay.nights} × ${formatCents(stay.dailyRateCents)}`} />
          <Row l="Entrada" v={fmtDateTime(stay.checkInAt)} />
          <Row l={stay.status === "closed" ? "Saída" : "Saída prevista"} v={fmtDateTime(stay.status === "closed" ? stay.checkedOutAt : stay.plannedCheckOutAt)} />
          <Row l="Valor previsto da hospedagem" v={formatCents(stay.totalPlannedCents)} />
        </dl>

        <p className="mt-6 text-slate-700">Declaro que as informações acima são verdadeiras e que estou ciente das normas da pousada.</p>
        <div className="mt-12 grid grid-cols-2 gap-10 text-center text-xs text-slate-600">
          <div className="border-t border-slate-400 pt-1">Assinatura do hóspede</div>
          <div className="border-t border-slate-400 pt-1">Recepção</div>
        </div>
        <p className="mt-8 text-xs text-slate-500">
          Dados pessoais usados apenas para o registro e a segurança da hospedagem, conforme a LGPD (Lei 13.709/2018).
          Ficha de uso interno da pousada: não substitui a Ficha Nacional de Registro de Hóspedes (FNRH) quando ela for exigida.
        </p>
      </article>
    </div>
  );
}
