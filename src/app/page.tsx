"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Spinner } from "@/components/ui";
import { BRAND } from "@/config/brand";
import { TRIAL_DAYS } from "@/lib/platform";

const FEATURES: [string, string][] = [
  ["Check-in e hospedagem 24 h", "Diária de 24 horas a partir da entrada, prorrogação, consumos e check-out com comprovante."],
  ["Reservas sem conflito", "Agenda por quarto: o sistema não deixa reservar duas vezes o mesmo quarto nas mesmas datas."],
  ["Portal do hóspede por QR Code", "O hóspede vê a conta e conversa com a recepção pelo celular, sem instalar nada e sem cadastro."],
  ["Financeiro e caixa", "Abertura e fechamento de caixa, contas a pagar e a receber, DRE e relatório de ocupação (diária média e RevPAR)."],
  ["Limpeza e manutenção", "Fila de quartos para limpar e chamados de manutenção com histórico."],
  ["Equipe com permissões", "Proprietário, administrador, recepção, financeiro e funcionário: cada um vê só o que precisa."],
  ["Funciona no celular", "Instalável como aplicativo (PWA) e com aviso de saída pelo WhatsApp em um toque."],
  ["Seus dados são seus", "Backup completo em um clique e cada pousada com os próprios dados isolados das outras."],
];

const STEPS: [string, string][] = [
  ["Crie sua conta", "Cadastro com e-mail e senha, sem cartão de crédito."],
  ["Cadastre a pousada e os quartos", "Em poucos minutos o sistema está pronto para o primeiro check-in."],
  ["Convide a equipe", "Cada pessoa entra com o próprio acesso e o perfil certo."],
];

export default function Home() {
  const { loading, user, membership } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading || !user) return;
    router.replace(membership ? "/painel/" : "/onboarding/");
  }, [loading, user, membership, router]);

  if (loading || user) return <Spinner />;

  const wa = BRAND.salesWhatsapp
    ? `https://wa.me/${BRAND.salesWhatsapp}?text=${encodeURIComponent(`Olá! Quero conhecer o ${BRAND.name}.`)}`
    : null;

  return (
    <div className="bg-white text-slate-800">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <span className="text-lg font-bold text-brand-800">{BRAND.name}</span>
        <Link href="/login/" className="rounded-lg px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50">Entrar</Link>
      </header>

      <section className="mx-auto max-w-5xl px-4 py-14 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">{BRAND.tagline}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
          Hospedagens, reservas, caixa, limpeza e portal do hóspede em um só lugar, feito para a rotina de pousadas de funcionamento 24 horas.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/login/?modo=cadastro" className="rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white shadow-sm hover:bg-brand-700">Testar grátis por {TRIAL_DAYS} dias</Link>
          {wa && <a href={wa} className="rounded-lg px-6 py-3 font-semibold text-brand-700 ring-1 ring-brand-600/40 hover:bg-brand-50">Falar com a gente</a>}
        </div>
        <p className="mt-3 text-sm text-slate-500">Sem cartão de crédito. Você exporta seus dados quando quiser.</p>
      </section>

      <section className="bg-slate-50 py-14">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="text-center text-2xl font-bold text-slate-900">Tudo o que a recepção precisa</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(([t, d]) => (
              <div key={t} className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="font-semibold text-slate-900">{t}</h3>
                <p className="mt-1 text-sm text-slate-600">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-14">
        <h2 className="text-center text-2xl font-bold text-slate-900">Comece em três passos</h2>
        <ol className="mt-8 grid gap-4 sm:grid-cols-3">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="rounded-xl border border-slate-200 p-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 font-bold text-white">{i + 1}</span>
              <h3 className="mt-3 font-semibold text-slate-900">{t}</h3>
              <p className="mt-1 text-sm text-slate-600">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="bg-slate-50 py-14">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h2 className="text-2xl font-bold text-slate-900">Privacidade levada a sério (LGPD)</h2>
          <p className="mt-3 text-slate-600">
            Os dados dos seus hóspedes pertencem à sua pousada. Cada pousada é isolada das demais e o acesso é separado por perfil.
            Nós, como fornecedores do sistema, acompanhamos apenas números de uso (como quantidade de quartos) e <strong>nunca</strong> vemos
            nome, documento, contato, valores ou mensagens dos seus hóspedes.
          </p>
          <p className="mt-3 text-sm text-slate-500">
            <Link href="/privacidade/" className="underline">Política de Privacidade</Link> · <Link href="/termos/" className="underline">Termos de Uso</Link>
          </p>
        </div>
      </section>

      <footer className="mx-auto max-w-5xl px-4 py-8 text-center text-sm text-slate-500">
        © {BRAND.name}{BRAND.contactEmail && <> · <a className="underline" href={`mailto:${BRAND.contactEmail}`}>{BRAND.contactEmail}</a></>}
      </footer>
    </div>
  );
}
