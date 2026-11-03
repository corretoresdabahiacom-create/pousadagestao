import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND } from "@/config/brand";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/" className="text-sm text-brand-700 underline">← Voltar</Link>
      <h1 className="mt-4 text-3xl font-bold text-slate-900">{title}</h1>
      <p className="mt-1 text-sm text-slate-500">{BRAND.name} · Última atualização: novembro de 2026</p>
      <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-600/20">
        Texto-base elaborado para o produto. Antes de usar comercialmente, a empresa responsável deve revisá-lo com um advogado e preencher os dados de contato e CNPJ.
      </p>
      <div className="prose-sm mt-6 space-y-4 text-slate-700 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-900 [&_ul]:list-disc [&_ul]:pl-6">{children}</div>
    </main>
  );
}
