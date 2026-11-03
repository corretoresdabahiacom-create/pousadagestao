"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { sendEmailVerification } from "firebase/auth";
import { friendlyError, useAuth } from "@/lib/auth/AuthProvider";
import { acceptInvite, readMyInvite } from "@/lib/tenants";
import { ROLE_LABELS, type Role } from "@/lib/types";
import { Alert, Button, Card, Spinner } from "@/components/ui";
import { BRAND } from "@/config/brand";

function InviteFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const tenantId = params.get("t") ?? "";
  const { loading, user, emailVerified, membership, refresh, logout } = useAuth();

  const [role, setRole] = useState<Role | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const here = `/convite/?t=${encodeURIComponent(tenantId)}`;

  useEffect(() => {
    if (loading || !user || !emailVerified || !tenantId || membership) return;
    let alive = true;
    readMyInvite(tenantId, user.email ?? "")
      .then((inv) => alive && (setRole(inv?.role ?? null), setChecked(true)))
      .catch(() => alive && (setRole(null), setChecked(true)));
    return () => {
      alive = false;
    };
  }, [loading, user, emailVerified, tenantId, membership]);

  useEffect(() => {
    if (!loading && membership) router.replace("/painel/");
  }, [loading, membership, router]);

  if (loading) return <Spinner />;

  async function accept() {
    if (!user || !role) return;
    setBusy(true);
    setError("");
    try {
      await acceptInvite(user, tenantId, role);
      await refresh();
      router.replace("/painel/");
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <h1 className="mb-6 text-center text-2xl font-bold text-brand-800">{BRAND.name}</h1>
      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">Convite para a equipe</h2>

        {!tenantId && <Alert>Link de convite inválido. Peça um novo ao proprietário.</Alert>}

        {tenantId && !user && (
          <>
            <p className="text-sm text-slate-600">
              Entre ou crie sua conta <strong>com o mesmo e-mail que recebeu o convite</strong>.
            </p>
            <Link href={`/login/?next=${encodeURIComponent(here)}`}>
              <Button className="w-full">Entrar ou criar conta</Button>
            </Link>
          </>
        )}

        {tenantId && user && !emailVerified && (
          <>
            <p className="text-sm text-slate-600">
              Confirme seu e-mail <strong>{user.email}</strong> pelo link que enviamos e depois toque em “Já confirmei”.
            </p>
            {info && <Alert kind="success">{info}</Alert>}
            {error && <Alert>{error}</Alert>}
            <div className="flex gap-3">
              <Button
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await refresh();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Já confirmei
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    await sendEmailVerification(user);
                    setInfo("E-mail reenviado.");
                  } catch (e) {
                    setError(friendlyError(e));
                  }
                }}
              >
                Reenviar
              </Button>
            </div>
          </>
        )}

        {tenantId && user && emailVerified && !checked && <Spinner label="Procurando seu convite…" />}

        {tenantId && user && emailVerified && checked && !role && (
          <>
            <Alert>
              Não encontramos convite para <strong>{user.email}</strong> nesta pousada. Confira se entrou com o e-mail
              certo ou peça um novo convite.
            </Alert>
            <Button variant="secondary" onClick={logout}>
              Sair e trocar de conta
            </Button>
          </>
        )}

        {tenantId && user && emailVerified && checked && role && (
          <>
            <p className="text-sm text-slate-600">
              Você foi convidado como <strong>{ROLE_LABELS[role]}</strong>.
            </p>
            {error && <Alert>{error}</Alert>}
            <Button onClick={accept} loading={busy} className="w-full">
              Aceitar convite
            </Button>
          </>
        )}
      </Card>
    </main>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <InviteFlow />
    </Suspense>
  );
}
