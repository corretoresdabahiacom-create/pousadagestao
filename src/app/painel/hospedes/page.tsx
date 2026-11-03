"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import { audit } from "@/lib/audit";
import { friendlyError, useAuth } from "@/lib/auth/AuthProvider";
import { guestDoc, type GuestData } from "@/lib/stays";
import { emptyGuest, matchGuest, useGuests, type GuestRecord } from "@/lib/useGuests";
import { GuestFields } from "@/components/GuestFields";
import { Alert, Button, Card, EmptyState, Input, Modal, Spinner } from "@/components/ui";

const PAGE = 20;

export default function GuestsPage() {
  const { user, membership } = useAuth();
  const tenantId = membership?.tenantId;
  const allowed = ["owner", "admin", "reception"].includes(membership?.role ?? "");
  const { guests, error, reload } = useGuests(allowed ? tenantId : undefined);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<GuestRecord | "new" | null>(null);
  const [notice, setNotice] = useState("");

  const filtered = useMemo(() => (guests ?? []).filter((g) => matchGuest(g, q)), [guests, q]);

  if (!allowed) return <Alert>Seu perfil não tem acesso ao cadastro de hóspedes.</Alert>;
  if (error) return <Alert>{error}</Alert>;
  if (!guests || !tenantId || !user) return <Spinner />;

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Hóspedes</h1>
          <p className="text-sm text-slate-600">Cadastro de quem já se hospedou. Cada nova hospedagem é sempre independente.</p>
        </div>
        <Button onClick={() => setEditing("new")}>Novo hóspede</Button>
      </div>
      {notice && <Alert kind="success">{notice}</Alert>}

      <Input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(0);
        }}
        placeholder="Buscar por nome, telefone, documento ou e-mail"
        aria-label="Buscar hóspede"
      />

      {filtered.length === 0 ? (
        <EmptyState title={guests.length ? "Nenhum hóspede encontrado" : "Nenhum hóspede cadastrado"} text="Os hóspedes são cadastrados no check-in ou aqui." />
      ) : (
        <Card className="!p-0">
          <ul className="divide-y divide-slate-100">
            {shown.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{g.fullName}</p>
                  <p className="truncate text-sm text-slate-500">{[g.whatsapp || g.phone, g.email].filter(Boolean).join(" · ") || "Sem contato"}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" className="px-3 py-1.5" onClick={() => setEditing(g)}>Editar</Button>
                  <Link href={`/painel/checkin/?guest=${g.id}`} className="inline-flex items-center rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800">
                    Novo check-in
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
          <span>Página {page + 1} de {pages}</span>
          <Button variant="secondary" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
        </div>
      )}

      {editing && (
        <GuestModal
          guest={editing === "new" ? null : editing}
          tenantId={tenantId}
          uid={user.uid}
          onClose={() => setEditing(null)}
          onSaved={(m) => {
            setEditing(null);
            setNotice(m);
            reload();
          }}
        />
      )}
    </div>
  );
}

function GuestModal({
  guest,
  tenantId,
  uid,
  onClose,
  onSaved,
}: {
  guest: GuestRecord | null;
  tenantId: string;
  uid: string;
  onClose: () => void;
  onSaved: (m: string) => void;
}) {
  const [form, setForm] = useState<GuestData>(guest ?? emptyGuest);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.fullName.trim()) return setError("Informe o nome completo.");
    setBusy(true);
    setError("");
    try {
      const { db } = getFirebase();
      const ref = guest ? doc(db, `tenants/${tenantId}/guests/${guest.id}`) : doc(db, `tenants/${tenantId}/guests/${crypto.randomUUID()}`);
      await setDoc(ref, guest ? guestDoc(form) : { ...guestDoc(form), createdBy: uid, createdAt: serverTimestamp() }, { merge: true });
      await audit(tenantId, uid, guest ? "guest.update" : "guest.create", { guestId: ref.id });
      onSaved(guest ? "Hóspede atualizado." : "Hóspede cadastrado.");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={guest ? "Editar hóspede" : "Novo hóspede"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <GuestFields value={form} onChange={setForm} />
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}
