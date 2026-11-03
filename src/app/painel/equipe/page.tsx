"use client";

import { useEffect, useState, type FormEvent } from "react";
import { collection, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import { audit } from "@/lib/audit";
import { friendlyError, useAuth } from "@/lib/auth/AuthProvider";
import { removeInvite } from "@/lib/tenants";
import { INVITABLE_ROLES, ROLE_LABELS, isManager, type Invite, type Member, type Role } from "@/lib/types";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Select, Spinner } from "@/components/ui";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function TeamPage() {
  const { user, membership } = useAuth();
  const tenantId = membership?.tenantId;
  const isOwner = membership?.role === "owner";

  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("reception");
  const [busy, setBusy] = useState(false);
  const [lastLink, setLastLink] = useState("");

  useEffect(() => {
    if (!tenantId) return;
    const { db } = getFirebase();
    const unsubM = onSnapshot(
      collection(db, `tenants/${tenantId}/members`),
      (snap) =>
        setMembers(
          snap.docs.map((d) => ({
            uid: d.id,
            role: d.data().role as Role,
            active: d.data().active === true,
            name: d.data().name as string | undefined,
            email: d.data().email as string | undefined,
          })),
        ),
      () => setError("Não foi possível carregar a equipe."),
    );
    const unsubI = onSnapshot(
      collection(db, `tenants/${tenantId}/invites`),
      (snap) => setInvites(snap.docs.map((d) => ({ email: d.id, role: d.data().role as Role }))),
      () => setError("Não foi possível carregar os convites."),
    );
    return () => {
      unsubM();
      unsubI();
    };
  }, [tenantId]);

  if (!isManager(membership?.role)) return <Alert>Apenas o proprietário e os administradores gerenciam a equipe.</Alert>;
  if (error) return <Alert>{error}</Alert>;
  if (!members || !tenantId || !user) return <Spinner />;

  const link = (typeof window !== "undefined" ? window.location.origin : "") + `/convite/?t=${tenantId}`;

  async function invite(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    const addr = email.trim().toLowerCase();
    if (!EMAIL_RE.test(addr)) return setError("Informe um e-mail válido.");
    if (members!.some((m) => m.email === addr)) return setError("Esta pessoa já faz parte da equipe.");
    setBusy(true);
    try {
      const { db } = getFirebase();
      await setDoc(doc(db, `tenants/${tenantId}/invites/${addr}`), {
        role,
        createdBy: user!.uid,
        createdAt: serverTimestamp(),
      });
      await audit(tenantId!, user!.uid, "invite.create", { email: addr, role });
      setEmail("");
      setLastLink(link);
      setNotice(`Convite criado para ${addr}. Envie o link abaixo para a pessoa.`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Link copiado.");
    } catch {
      setNotice("Não foi possível copiar automaticamente. Selecione e copie o link.");
    }
  }

  async function updateMember(m: Member, patch: Partial<Pick<Member, "role" | "active">>, action: string) {
    setError("");
    try {
      const { db } = getFirebase();
      await updateDoc(doc(db, `tenants/${tenantId}/members/${m.uid}`), patch);
      await audit(tenantId!, user!.uid, action, { memberUid: m.uid, ...patch });
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function cancelInvite(addr: string) {
    setError("");
    try {
      await removeInvite(tenantId!, addr);
      await audit(tenantId!, user!.uid, "invite.cancel", { email: addr });
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Equipe</h1>
        <p className="text-sm text-slate-600">Quem tem acesso ao sistema e com qual papel.</p>
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <Card>
        <h2 className="mb-3 text-base font-semibold">Convidar pessoa</h2>
        <form onSubmit={invite} className="grid gap-4 sm:grid-cols-[1fr_200px_auto] sm:items-end">
          <Field label="E-mail da pessoa">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Papel">
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {INVITABLE_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </Select>
          </Field>
          <Button type="submit" loading={busy}>Criar convite</Button>
        </form>
        {lastLink && (
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
            <p className="mb-1 text-slate-600">
              Envie este link (WhatsApp, e-mail…). A pessoa deve entrar com o <strong>mesmo e-mail</strong> do convite.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-white px-2 py-1 ring-1 ring-slate-200">{lastLink}</code>
              <Button variant="secondary" className="px-3 py-1.5" onClick={() => copy(lastLink)}>Copiar</Button>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-base font-semibold">Membros</h2>
        <ul className="divide-y divide-slate-100">
          {members.map((m) => {
            const self = m.uid === user.uid;
            return (
              <li key={m.uid} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {m.name || m.email || m.uid} {self && <span className="text-xs text-slate-500">(você)</span>}
                  </p>
                  {m.name && <p className="truncate text-sm text-slate-500">{m.email}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!m.active && <Badge className="bg-slate-100 text-slate-600 ring-slate-500/20">Desativado</Badge>}
                  {isOwner && !self ? (
                    <>
                      <Select
                        aria-label={`Papel de ${m.name || m.email}`}
                        value={m.role}
                        onChange={(e) => updateMember(m, { role: e.target.value as Role }, "member.role")}
                        className="!w-auto !py-1.5"
                      >
                        {(["admin", "reception", "finance", "staff"] as Role[]).map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                        {m.role === "owner" && <option value="owner">{ROLE_LABELS.owner}</option>}
                      </Select>
                      <Button
                        variant={m.active ? "secondary" : "primary"}
                        className="px-3 py-1.5"
                        onClick={() => updateMember(m, { active: !m.active }, m.active ? "member.deactivate" : "member.activate")}
                      >
                        {m.active ? "Desativar" : "Reativar"}
                      </Button>
                    </>
                  ) : (
                    <Badge className="bg-teal-50 text-teal-800 ring-teal-600/20">{ROLE_LABELS[m.role]}</Badge>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-3 text-base font-semibold">Convites pendentes</h2>
        {invites.length === 0 ? (
          <EmptyState title="Nenhum convite pendente" text="Quando você convidar alguém, o convite aparece aqui até ser aceito." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {invites.map((i) => (
              <li key={i.email} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{i.email}</p>
                  <p className="text-sm text-slate-500">{ROLE_LABELS[i.role]}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" className="px-3 py-1.5" onClick={() => copy(link)}>Copiar link</Button>
                  <Button variant="ghost" className="px-3 py-1.5" onClick={() => cancelInvite(i.email)}>Cancelar</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
