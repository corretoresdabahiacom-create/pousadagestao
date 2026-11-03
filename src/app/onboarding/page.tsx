"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { sendEmailVerification } from "firebase/auth";
import { friendlyError, useAuth } from "@/lib/auth/AuthProvider";
import { createTenant, type TenantForm } from "@/lib/tenants";
import { TIMEZONES, UF_LIST } from "@/lib/types";
import { Alert, Button, Card, Field, Input, Select, Spinner } from "@/components/ui";
import { BRAND } from "@/config/brand";

const empty: TenantForm = {
  legalName: "",
  displayName: "",
  cnpj: "",
  phone: "",
  whatsapp: "",
  email: "",
  address: "",
  city: "",
  state: "BA",
  zip: "",
  timezone: "America/Sao_Paulo",
  checkInTime: "14:00",
  checkOutTime: "12:00",
};

export default function OnboardingPage() {
  const router = useRouter();
  const { loading, user, emailVerified, membership, refresh, logout } = useAuth();
  const [form, setForm] = useState<TenantForm>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login/");
    else if (membership) router.replace("/painel/");
  }, [loading, user, membership, router]);

  if (loading || !user || membership) return <Spinner />;

  const set = (k: keyof TenantForm) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function checkVerified() {
    setError("");
    setInfo("");
    setBusy(true);
    try {
      await refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError("");
    setInfo("");
    try {
      if (user) await sendEmailVerification(user);
      setInfo("E-mail reenviado. Confira também a caixa de spam.");
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError("");
    setBusy(true);
    try {
      await createTenant(user, form);
      await refresh();
      router.replace("/painel/");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-teal-800">{BRAND.name}</h1>
        <button onClick={logout} className="text-sm text-slate-600 hover:underline">
          Sair ({user.email})
        </button>
      </div>

      {!emailVerified ? (
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">Confirme seu e-mail</h2>
          <p className="text-sm text-slate-600">
            Enviamos um link de confirmação para <strong>{user.email}</strong>. Abra o e-mail, clique no link e volte
            aqui. A confirmação protege os dados da sua pousada.
          </p>
          {error && <Alert>{error}</Alert>}
          {info && <Alert kind="success">{info}</Alert>}
          <div className="flex flex-wrap gap-3">
            <Button onClick={checkVerified} loading={busy}>
              Já confirmei
            </Button>
            <Button variant="secondary" onClick={resend}>
              Reenviar e-mail
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            Foi convidado por uma pousada? Abra o link de convite que você recebeu, em vez de criar uma pousada nova.
          </p>
        </Card>
      ) : (
        <form onSubmit={onSubmit} className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold">Cadastre sua pousada</h2>
            <p className="text-sm text-slate-600">Você poderá editar tudo isso depois. Foi convidado? Use o link do convite.</p>
          </div>

          <Card className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome empresarial ou comercial">
              <Input value={form.legalName} onChange={set("legalName")} required minLength={2} />
            </Field>
            <Field label="Nome de exibição" hint="Aparece para o hóspede.">
              <Input value={form.displayName} onChange={set("displayName")} required minLength={2} />
            </Field>
            <Field label="CNPJ (opcional)">
              <Input value={form.cnpj} onChange={set("cnpj")} inputMode="numeric" />
            </Field>
            <Field label="E-mail da pousada">
              <Input type="email" value={form.email} onChange={set("email")} />
            </Field>
            <Field label="Telefone">
              <Input value={form.phone} onChange={set("phone")} inputMode="tel" />
            </Field>
            <Field label="WhatsApp">
              <Input value={form.whatsapp} onChange={set("whatsapp")} inputMode="tel" />
            </Field>
          </Card>

          <Card className="grid gap-4 sm:grid-cols-6">
            <div className="sm:col-span-6">
              <Field label="Endereço">
                <Input value={form.address} onChange={set("address")} />
              </Field>
            </div>
            <div className="sm:col-span-3">
              <Field label="Cidade">
                <Input value={form.city} onChange={set("city")} required />
              </Field>
            </div>
            <div className="sm:col-span-1">
              <Field label="UF">
                <Select value={form.state} onChange={set("state")}>
                  {UF_LIST.map((uf) => (
                    <option key={uf}>{uf}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="CEP">
                <Input value={form.zip} onChange={set("zip")} inputMode="numeric" />
              </Field>
            </div>
          </Card>

          <Card className="grid gap-4 sm:grid-cols-3">
            <Field label="Fuso horário">
              <Select value={form.timezone} onChange={set("timezone")}>
                {TIMEZONES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Horário padrão de check-in">
              <Input type="time" value={form.checkInTime} onChange={set("checkInTime")} required />
            </Field>
            <Field label="Horário padrão de checkout">
              <Input type="time" value={form.checkOutTime} onChange={set("checkOutTime")} required />
            </Field>
          </Card>

          {error && <Alert>{error}</Alert>}
          <Button type="submit" loading={busy} className="w-full sm:w-auto">
            Criar pousada
          </Button>
        </form>
      )}
    </main>
  );
}
