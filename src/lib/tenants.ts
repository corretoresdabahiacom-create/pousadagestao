import type { User } from "firebase/auth";
import { collection, deleteDoc, doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import { INVITABLE_ROLES, type Role } from "@/lib/types";

export interface TenantForm {
  legalName: string;
  displayName: string;
  cnpj: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  timezone: string;
  checkInTime: string;
  checkOutTime: string;
}

/**
 * Cria a pousada. Em dois lotes porque as Rules das subcoleções só reconhecem o membro
 * depois que o vínculo de proprietário foi gravado:
 *   1) pousada + proprietário + índice do usuário;
 *   2) configurações, dados públicos e auditoria.
 */
export async function createTenant(user: User, f: TenantForm): Promise<string> {
  const { db } = getFirebase();
  const tenantRef = doc(collection(db, "tenants"));
  const t = tenantRef.id;

  const b1 = writeBatch(db);
  b1.set(tenantRef, {
    name: f.legalName.trim(),
    displayName: f.displayName.trim(),
    ownerUid: user.uid,
    planId: "trial",
    status: "trial",
    createdAt: serverTimestamp(),
  });
  b1.set(doc(db, `tenants/${t}/members/${user.uid}`), {
    role: "owner",
    active: true,
    name: user.displayName ?? "",
    email: (user.email ?? "").toLowerCase(),
    createdAt: serverTimestamp(),
  });
  b1.set(doc(db, `users/${user.uid}`), { tenantId: t });
  await b1.commit();

  const b2 = writeBatch(db);
  b2.set(doc(db, `tenants/${t}/settings/main`), {
    cnpj: f.cnpj.trim(),
    phone: f.phone.trim(),
    whatsapp: f.whatsapp.trim(),
    email: f.email.trim(),
    address: f.address.trim(),
    city: f.city.trim(),
    state: f.state,
    zip: f.zip.trim(),
    timezone: f.timezone,
    currency: "BRL",
    checkInTime: f.checkInTime,
    checkOutTime: f.checkOutTime,
    checkoutReminderText:
      "Olá! Lembramos que seu horário de checkout está próximo. Esperamos que tenha aproveitado sua estadia!",
    updatedAt: serverTimestamp(),
  });
  b2.set(doc(db, `tenants/${t}/publicInfo/main`), {
    displayName: f.displayName.trim(),
    phone: f.phone.trim(),
    whatsapp: f.whatsapp.trim(),
    address: f.address.trim(),
    city: f.city.trim(),
    state: f.state,
    checkInTime: f.checkInTime,
    checkOutTime: f.checkOutTime,
    updatedAt: serverTimestamp(),
  });
  b2.set(doc(collection(db, `tenants/${t}/auditLogs`)), {
    actorUid: user.uid,
    action: "tenant.create",
    details: {},
    at: serverTimestamp(),
  });
  await b2.commit();
  return t;
}

export interface InviteInfo {
  role: Role;
}

/** Lê o convite do próprio usuário (e-mail verificado). Retorna null se não houver. */
export async function readMyInvite(tenantId: string, email: string): Promise<InviteInfo | null> {
  const { db } = getFirebase();
  const snap = await getDoc(doc(db, `tenants/${tenantId}/invites/${email.toLowerCase()}`));
  if (!snap.exists()) return null;
  const role = snap.data().role as Role;
  return INVITABLE_ROLES.includes(role) ? { role } : null;
}

/** Aceita o convite: cria o vínculo, o índice do usuário e remove o convite, num único lote. */
export async function acceptInvite(user: User, tenantId: string, role: Role): Promise<void> {
  const { db } = getFirebase();
  const email = (user.email ?? "").toLowerCase();
  const b = writeBatch(db);
  b.set(doc(db, `tenants/${tenantId}/members/${user.uid}`), {
    role,
    active: true,
    name: user.displayName ?? "",
    email,
    createdAt: serverTimestamp(),
  });
  b.set(doc(db, `users/${user.uid}`), { tenantId });
  b.delete(doc(db, `tenants/${tenantId}/invites/${email}`));
  await b.commit();
}

export async function removeInvite(tenantId: string, email: string): Promise<void> {
  const { db } = getFirebase();
  await deleteDoc(doc(db, `tenants/${tenantId}/invites/${email.toLowerCase()}`));
}
