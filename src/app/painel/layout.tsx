"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROLE_LABELS, isManager } from "@/lib/types";
import { Spinner } from "@/components/ui";
import { BRAND } from "@/config/brand";
import { useBrandTheme } from "@/lib/branding";

export default function PainelLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { loading, user, membership, tenant, logout } = useAuth();
  const [open, setOpen] = useState(false);
  useBrandTheme(membership?.tenantId);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login/");
    else if (!membership) router.replace("/onboarding/");
  }, [loading, user, membership, router]);

  if (loading || !user || !membership || !tenant) return <Spinner />;

  const role = membership.role;
  const manager = isManager(role);
  const front = role === "owner" || role === "admin" || role === "reception";
  const money = role === "owner" || role === "admin" || role === "finance";
  const ops = front || role === "staff";
  const nav = [
    { href: "/painel/", label: "Início", show: true },
    { href: "/painel/checkin/", label: "Check-in", show: front },
    { href: "/painel/hospedagens/", label: "Hospedagens", show: front || role === "finance" },
    { href: "/painel/calendario/", label: "Calendário", show: front },
    { href: "/painel/chat/", label: "Chat", show: front },
    { href: "/painel/hospedes/", label: "Hóspedes", show: front },
    { href: "/painel/quartos/", label: "Quartos", show: true },
    { href: "/painel/limpeza/", label: "Limpeza", show: ops },
    { href: "/painel/manutencao/", label: "Manutenção", show: ops },
    { href: "/painel/financeiro/", label: "Financeiro", show: money },
    { href: "/painel/relatorios/", label: "Relatórios", show: money || role === "reception" },
    { href: "/painel/personalizar/", label: "Personalizar", show: manager },
    { href: "/painel/equipe/", label: "Equipe", show: manager },
  ].filter((n) => n.show);

  const isActive = (href: string) => (href === "/painel/" ? pathname === "/painel/" || pathname === "/painel" : pathname.startsWith(href.replace(/\/$/, "")));

  const menu = (
    <nav className="flex flex-col gap-1 p-3">
      {nav.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          onClick={() => setOpen(false)}
          className={`rounded-lg px-3 py-2 text-sm font-medium ${
            isActive(n.href) ? "bg-brand-50 text-brand-800" : "text-slate-700 hover:bg-slate-100"
          }`}
        >
          {n.label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Menu lateral (desktop) */}
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:block">
        <div className="border-b border-slate-200 p-4">
          <p className="text-lg font-bold text-brand-800">{BRAND.name}</p>
          <p className="mt-0.5 truncate text-sm text-slate-600">{tenant.displayName || tenant.name}</p>
        </div>
        {menu}
      </aside>

      {/* Barra superior (celular) */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <div className="min-w-0">
          <p className="font-bold text-brand-800">{BRAND.name}</p>
          <p className="truncate text-xs text-slate-600">{tenant.displayName || tenant.name}</p>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          aria-expanded={open}
          aria-label="Abrir menu"
        >
          Menu
        </button>
      </header>
      {open && <div className="border-b border-slate-200 bg-white lg:hidden">{menu}</div>}

      <div className="min-w-0 flex-1">
        <div className="hidden items-center justify-end gap-4 border-b border-slate-200 bg-white px-6 py-3 text-sm lg:flex">
          <span className="text-slate-600">
            {user.displayName || user.email} · {ROLE_LABELS[membership.role]}
          </span>
          <button onClick={logout} className="font-medium text-brand-700 hover:underline">
            Sair
          </button>
        </div>
        <main className="mx-auto max-w-6xl p-4 sm:p-6">
          {tenant.status === "trial" && (
            <p className="mb-4 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/20">
              Período de teste.
            </p>
          )}
          {children}
          <div className="mt-8 lg:hidden">
            <button onClick={logout} className="text-sm font-medium text-brand-700 hover:underline">
              Sair ({user.email})
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
