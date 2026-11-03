import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, getDocs, collection, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

let env: RulesTestEnvironment;

const A = "pousada-a";
const B = "pousada-b";
const HASH = "a".repeat(64); // hash do token do QR Code (SHA-256 em hex tem 64 caracteres)
const HASH_B = "b".repeat(64);
const ROLES = ["owner", "admin", "reception", "finance", "staff"] as const;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "pousadagestao-rules-test",
    firestore: {
      rules: readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [t, h] of [[A, HASH], [B, HASH_B]] as const) {
      await setDoc(doc(db, `tenants/${t}`), { name: t, ownerUid: `${t}-owner`, planId: "trial", status: "active", limits: { rooms: 5 } });
      for (const r of ROLES) {
        await setDoc(doc(db, `tenants/${t}/members/${t}-${r}`), { role: r, active: true });
      }
      await setDoc(doc(db, `tenants/${t}/members/${t}-inactive`), { role: "owner", active: false });
      await setDoc(doc(db, `tenants/${t}/rooms/r1`), { number: "1", status: "available", dailyRateCents: 20000 });
      await setDoc(doc(db, `tenants/${t}/rooms/r2`), { number: "2", status: "occupied" });
      await setDoc(doc(db, `tenants/${t}/rooms/r3`), { number: "3", status: "awaiting_cleaning" });
      await setDoc(doc(db, `tenants/${t}/rooms/r4`), { number: "4", status: "cleaning" });
      await setDoc(doc(db, `tenants/${t}/guests/g1`), { fullName: "Hóspede " + t });
      await setDoc(doc(db, `tenants/${t}/stays/s1`), { status: "active", roomId: "r1", guestId: "g1", accessHash: h, createdBy: "x", totalCents: 60000 });
      await setDoc(doc(db, `tenants/${t}/stays/s1/charges/c1`), { status: "active", quantity: 1, unitCents: 500, totalCents: 500, createdBy: "x" });
      await setDoc(doc(db, `tenants/${t}/stays/s1/payments/p1`), { amountCents: 1000, kind: "payment", createdBy: "x" });
      await setDoc(doc(db, `tenants/${t}/stayAccess/${h}`), { stayId: "s1", status: "active" });
      await setDoc(doc(db, `tenants/${t}/accountsPayable/ap1`), { amountCents: 5000, status: "open", createdBy: "x" });
      await setDoc(doc(db, `tenants/${t}/auditLogs/a1`), { action: "x" });
    }
  });
});

const staff = (tenantId: string, role: string) => env.authenticatedContext(`${tenantId}-${role}`, { email_verified: true }).firestore();
const guest = (uid: string) => env.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } }).firestore();

describe("isolamento multi-tenant", () => {
  it("membro da pousada A lê dados da A", async () => {
    await assertSucceeds(getDoc(doc(staff(A, "owner"), `tenants/${A}/rooms/r1`)));
  });

  it("membro da pousada A NÃO lê nem escreve na B, em nenhum papel", async () => {
    for (const role of ROLES) {
      const db = staff(A, role);
      await assertFails(getDoc(doc(db, `tenants/${B}`)));
      await assertFails(getDoc(doc(db, `tenants/${B}/rooms/r1`)));
      await assertFails(getDoc(doc(db, `tenants/${B}/guests/g1`)));
      await assertFails(getDoc(doc(db, `tenants/${B}/stays/s1`)));
      await assertFails(setDoc(doc(db, `tenants/${B}/rooms/r9`), { number: "9", status: "available" }));
    }
  });

  it("não autenticado não lê nada", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `tenants/${A}`)));
    await assertFails(getDoc(doc(db, `tenants/${A}/stays/s1`)));
  });

  it("membro desativado perde o acesso", async () => {
    const db = env.authenticatedContext(`${A}-inactive`, { email_verified: true }).firestore();
    await assertFails(getDoc(doc(db, `tenants/${A}/rooms/r1`)));
  });

  it("pousada suspensa bloqueia a equipe", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), `tenants/${A}`), { status: "suspended" });
    });
    await assertFails(getDoc(doc(staff(A, "owner"), `tenants/${A}/rooms/r1`)));
  });
});

describe("cadastro da pousada e convites", () => {
  const newTenant = (uid: string) => ({
    name: "Nova", ownerUid: uid, planId: "trial", status: "trial",
  });

  it("usuário verificado cria pousada, vira proprietário e configura em seguida (fluxo do onboarding)", async () => {
    const db = env.authenticatedContext("novo", { email_verified: true }).firestore();
    const { writeBatch } = await import("firebase/firestore");
    const b = writeBatch(db);
    b.set(doc(db, "tenants/nova"), newTenant("novo"));
    b.set(doc(db, "tenants/nova/members/novo"), { role: "owner", active: true });
    b.set(doc(db, "users/novo"), { tenantId: "nova" });
    await assertSucceeds(b.commit());
    const b2 = writeBatch(db);
    b2.set(doc(db, "tenants/nova/settings/main"), { stayHours: 24 });
    b2.set(doc(db, "tenants/nova/publicInfo/main"), { displayName: "Nova" });
    b2.set(doc(collection(db, "tenants/nova/auditLogs")), { actorUid: "novo", at: serverTimestamp(), action: "tenant.create" });
    await assertSucceeds(b2.commit());
    await assertSucceeds(getDoc(doc(db, "users/novo")));
  });

  it("não cria pousada sem e-mail verificado", async () => {
    const db = env.authenticatedContext("naoverificado", { email_verified: false }).firestore();
    const { writeBatch } = await import("firebase/firestore");
    const b = writeBatch(db);
    b.set(doc(db, "tenants/nova"), newTenant("naoverificado"));
    b.set(doc(db, "tenants/nova/members/naoverificado"), { role: "owner", active: true });
    await assertFails(b.commit());
  });

  it("índice users/{uid}: só aponta para pousada onde o usuário é membro ativo, e só o próprio lê", async () => {
    const db = env.authenticatedContext("intruso", { email_verified: true }).firestore();
    await assertFails(setDoc(doc(db, "users/intruso"), { tenantId: A }));
    await assertFails(setDoc(doc(staff(A, "owner"), `users/${B}-owner`), { tenantId: A }));
    await assertSucceeds(setDoc(doc(staff(A, "reception"), `users/${A}-reception`), { tenantId: A }));
    await assertFails(getDoc(doc(db, `users/${A}-reception`)));
    await assertFails(getDocs(collection(db, "users")));
  });

  it("convidado lê só o próprio convite e aceita em lote (membro + índice + remover convite)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `tenants/${A}/invites/bia@teste.com`), { role: "finance" });
      await setDoc(doc(ctx.firestore(), `tenants/${A}/invites/outro@teste.com`), { role: "admin" });
    });
    const db = env.authenticatedContext("bia", { email: "bia@teste.com", email_verified: true }).firestore();
    await assertSucceeds(getDoc(doc(db, `tenants/${A}/invites/bia@teste.com`)));
    await assertFails(getDoc(doc(db, `tenants/${A}/invites/outro@teste.com`)));
    await assertFails(getDocs(collection(db, `tenants/${A}/invites`)));
    const { writeBatch } = await import("firebase/firestore");
    const b = writeBatch(db);
    b.set(doc(db, `tenants/${A}/members/bia`), { role: "finance", active: true });
    b.set(doc(db, "users/bia"), { tenantId: A });
    b.delete(doc(db, `tenants/${A}/invites/bia@teste.com`));
    await assertSucceeds(b.commit());
    await assertSucceeds(getDoc(doc(db, `tenants/${A}/accountsPayable/ap1`)));
  });

  it("convite não-verificado não vale", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `tenants/${A}/invites/cris@teste.com`), { role: "admin" });
    });
    const db = env.authenticatedContext("cris", { email: "cris@teste.com", email_verified: false }).firestore();
    await assertFails(getDoc(doc(db, `tenants/${A}/invites/cris@teste.com`)));
    await assertFails(setDoc(doc(db, `tenants/${A}/members/cris`), { role: "admin", active: true }));
  });

  it("não cria pousada já com plano premium nem como dono de outro", async () => {
    const db = env.authenticatedContext("novo", { email_verified: true }).firestore();
    const { writeBatch } = await import("firebase/firestore");
    const b1 = writeBatch(db);
    b1.set(doc(db, "tenants/nova"), { ...newTenant("novo"), planId: "premium" });
    b1.set(doc(db, "tenants/nova/members/novo"), { role: "owner", active: true });
    await assertFails(b1.commit());
    const b2 = writeBatch(db);
    b2.set(doc(db, "tenants/nova2"), newTenant("outro"));
    b2.set(doc(db, "tenants/nova2/members/novo"), { role: "owner", active: true });
    await assertFails(b2.commit());
  });

  it("ninguém se torna proprietário de pousada já existente", async () => {
    const db = env.authenticatedContext("intruso", { email_verified: true }).firestore();
    await assertFails(setDoc(doc(db, `tenants/${A}/members/intruso`), { role: "owner", active: true }));
    await assertFails(setDoc(doc(db, `tenants/${A}/members/intruso`), { role: "admin", active: true }));
  });

  it("convidado aceita o convite com o papel combinado, e só com ele", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `tenants/${A}/invites/ana@teste.com`), { role: "reception" });
    });
    const db = env.authenticatedContext("ana", { email: "Ana@Teste.com", email_verified: true }).firestore();
    await assertFails(setDoc(doc(db, `tenants/${A}/members/ana`), { role: "admin", active: true }));
    await assertSucceeds(setDoc(doc(db, `tenants/${A}/members/ana`), { role: "reception", active: true }));
  });

  it("proprietário não altera plano, status ou limites; edita outros dados", async () => {
    const db = staff(A, "owner");
    await assertFails(updateDoc(doc(db, `tenants/${A}`), { planId: "premium" }));
    await assertFails(updateDoc(doc(db, `tenants/${A}`), { status: "active2" }));
    await assertFails(updateDoc(doc(db, `tenants/${A}`), { limits: { rooms: 999 } }));
    await assertSucceeds(updateDoc(doc(db, `tenants/${A}`), { displayName: "Nova" }));
  });
});

describe("personalização e galeria", () => {
  const photo = (uid: string, over: Record<string, unknown> = {}) => ({
    category: "refeitorio", dataUrl: "data:image/jpeg;base64,AAAA", caption: "Café da manhã",
    createdBy: uid, createdAt: serverTimestamp(), ...over,
  });

  it("gestor cria foto; recepção não; categoria inválida e foto grande demais são recusadas", async () => {
    await assertSucceeds(setDoc(doc(staff(A, "owner"), `tenants/${A}/photos/f1`), photo(`${A}-owner`)));
    await assertSucceeds(setDoc(doc(staff(A, "admin"), `tenants/${A}/photos/f2`), photo(`${A}-admin`)));
    await assertFails(setDoc(doc(staff(A, "reception"), `tenants/${A}/photos/f3`), photo(`${A}-reception`)));
    await assertFails(setDoc(doc(staff(A, "owner"), `tenants/${A}/photos/f4`), photo(`${A}-owner`, { category: "x" })));
    await assertFails(setDoc(doc(staff(A, "owner"), `tenants/${A}/photos/f5`), photo(`${A}-owner`, { dataUrl: "a".repeat(260000) })));
    await assertFails(setDoc(doc(staff(B, "owner"), `tenants/${A}/photos/f6`), photo(`${B}-owner`)));
  });

  it("hóspede (anônimo) lê a galeria e os dados públicos, mas não altera", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `tenants/${A}/photos/f1`), { category: "garagem", dataUrl: "data:image/jpeg;base64,AAAA", createdBy: "x" });
    });
    const g = guest("hospede-1");
    await assertSucceeds(getDocs(collection(g, `tenants/${A}/photos`)));
    await assertFails(deleteDoc(doc(g, `tenants/${A}/photos/f1`)));
    await assertFails(setDoc(doc(g, `tenants/${A}/publicInfo/main`), { brandColor: "#ff0000" }));
  });

  it("cor da marca precisa ser hexadecimal; gestor edita, recepção não", async () => {
    const ref = (db: ReturnType<typeof staff>) => doc(db, `tenants/${A}/publicInfo/main`);
    await assertSucceeds(setDoc(ref(staff(A, "admin")), { displayName: "X", brandColor: "#1d4ed8", mapsUrl: "https://maps.app.goo.gl/abc" }));
    await assertFails(setDoc(ref(staff(A, "admin")), { displayName: "X", brandColor: "red" }));
    await assertFails(setDoc(ref(staff(A, "reception")), { displayName: "X", brandColor: "#1d4ed8" }));
  });

  it("gestor só altera a legenda da foto e pode excluí-la", async () => {
    await assertSucceeds(setDoc(doc(staff(A, "owner"), `tenants/${A}/photos/f1`), photo(`${A}-owner`)));
    await assertSucceeds(updateDoc(doc(staff(A, "owner"), `tenants/${A}/photos/f1`), { caption: "Novo" }));
    await assertFails(updateDoc(doc(staff(A, "owner"), `tenants/${A}/photos/f1`), { category: "garagem" }));
    await assertSucceeds(deleteDoc(doc(staff(A, "owner"), `tenants/${A}/photos/f1`)));
  });
});

describe("papéis", () => {
  it("financeiro: só quem tem papel financeiro lê contas a pagar", async () => {
    await assertFails(getDoc(doc(staff(A, "staff"), `tenants/${A}/accountsPayable/ap1`)));
    await assertFails(getDoc(doc(staff(A, "reception"), `tenants/${A}/accountsPayable/ap1`)));
    await assertSucceeds(getDoc(doc(staff(A, "finance"), `tenants/${A}/accountsPayable/ap1`)));
  });

  it("funcionário não vê dados pessoais de hóspedes", async () => {
    await assertFails(getDoc(doc(staff(A, "staff"), `tenants/${A}/guests/g1`)));
    await assertSucceeds(getDoc(doc(staff(A, "reception"), `tenants/${A}/guests/g1`)));
  });

  it("somente o proprietário lê auditoria; log só pode ser acrescentado", async () => {
    await assertSucceeds(getDoc(doc(staff(A, "owner"), `tenants/${A}/auditLogs/a1`)));
    await assertFails(getDoc(doc(staff(A, "admin"), `tenants/${A}/auditLogs/a1`)));
    const db = staff(A, "reception");
    await assertSucceeds(setDoc(doc(db, `tenants/${A}/auditLogs/a2`), { actorUid: `${A}-reception`, at: serverTimestamp(), action: "x" }));
    await assertFails(setDoc(doc(db, `tenants/${A}/auditLogs/a3`), { actorUid: "outro", at: serverTimestamp(), action: "x" }));
    await assertFails(updateDoc(doc(staff(A, "owner"), `tenants/${A}/auditLogs/a1`), { action: "adulterado" }));
    await assertFails(deleteDoc(doc(staff(A, "owner"), `tenants/${A}/auditLogs/a1`)));
  });

  it("transições de status do quarto respeitam o papel", async () => {
    await assertSucceeds(updateDoc(doc(staff(A, "reception"), `tenants/${A}/rooms/r1`), { status: "occupied" }));
    await assertFails(updateDoc(doc(staff(A, "reception"), `tenants/${A}/rooms/r3`), { status: "available" }));
    await assertSucceeds(updateDoc(doc(staff(A, "staff"), `tenants/${A}/rooms/r3`), { status: "cleaning" }));
    await assertSucceeds(updateDoc(doc(staff(A, "staff"), `tenants/${A}/rooms/r4`), { status: "available" }));
    await assertFails(updateDoc(doc(staff(A, "staff"), `tenants/${A}/rooms/r1`), { status: "occupied" }));
    await assertFails(updateDoc(doc(staff(A, "staff"), `tenants/${A}/rooms/r1`), { dailyRateCents: 1 }));
  });

  it("quarto nunca é excluído", async () => {
    await assertFails(deleteDoc(doc(staff(A, "owner"), `tenants/${A}/rooms/r1`)));
  });
});

describe("integridade financeira", () => {
  it("pagamento é imutável e o mesmo ID não pode ser criado duas vezes (idempotência)", async () => {
    const db = staff(A, "reception");
    const pay = { amountCents: 5000, kind: "payment", createdBy: `${A}-reception` };
    await assertSucceeds(setDoc(doc(db, `tenants/${A}/stays/s1/payments/idem-1`), pay));
    await assertFails(setDoc(doc(db, `tenants/${A}/stays/s1/payments/idem-1`), pay));
    await assertFails(updateDoc(doc(db, `tenants/${A}/stays/s1/payments/p1`), { amountCents: 1 }));
    await assertFails(deleteDoc(doc(db, `tenants/${A}/stays/s1/payments/p1`)));
  });

  it("pagamento exige valor positivo e autoria verdadeira", async () => {
    const db = staff(A, "reception");
    await assertFails(setDoc(doc(db, `tenants/${A}/stays/s1/payments/x1`), { amountCents: -5, kind: "payment", createdBy: `${A}-reception` }));
    await assertFails(setDoc(doc(db, `tenants/${A}/stays/s1/payments/x2`), { amountCents: 5.5, kind: "payment", createdBy: `${A}-reception` }));
    await assertFails(setDoc(doc(db, `tenants/${A}/stays/s1/payments/x3`), { amountCents: 100, kind: "payment", createdBy: "outro" }));
  });

  it("lançamento: total confere, nunca apaga, cancelamento exige justificativa", async () => {
    const db = staff(A, "reception");
    const ok = { status: "active", quantity: 2, unitCents: 300, totalCents: 600, createdBy: `${A}-reception` };
    await assertSucceeds(setDoc(doc(db, `tenants/${A}/stays/s1/charges/c2`), ok));
    await assertFails(setDoc(doc(db, `tenants/${A}/stays/s1/charges/c3`), { ...ok, totalCents: 1 }));
    await assertFails(deleteDoc(doc(db, `tenants/${A}/stays/s1/charges/c1`)));
    await assertFails(updateDoc(doc(db, `tenants/${A}/stays/s1/charges/c1`), { status: "cancelled" }));
    await assertSucceeds(updateDoc(doc(db, `tenants/${A}/stays/s1/charges/c1`), { status: "cancelled", cancelReason: "erro de digitação" }));
    await assertFails(updateDoc(doc(db, `tenants/${A}/stays/s1/charges/c1`), { totalCents: 1 }));
  });

  it("hospedagem encerrada não aceita novos lançamentos nem reabre", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), `tenants/${A}/stays/s1`), { status: "closed" });
    });
    const db = staff(A, "reception");
    await assertFails(setDoc(doc(db, `tenants/${A}/stays/s1/charges/c9`), { status: "active", quantity: 1, unitCents: 1, totalCents: 1, createdBy: `${A}-reception` }));
    await assertFails(updateDoc(doc(db, `tenants/${A}/stays/s1`), { status: "active" }));
  });

  it("vínculo do QR Code na hospedagem é imutável", async () => {
    await assertFails(updateDoc(doc(staff(A, "reception"), `tenants/${A}/stays/s1`), { accessHash: "c".repeat(64) }));
    await assertSucceeds(updateDoc(doc(staff(A, "reception"), `tenants/${A}/stays/s1`), { notes: "ok" }));
  });
});

describe("portal do hóspede (QR Code)", () => {
  const open = async (uid: string, hash = HASH, tenant = A) => {
    const db = guest(uid);
    await setDoc(doc(db, `tenants/${tenant}/stayAccess/${hash}/sessions/${uid}`), { createdAt: serverTimestamp() });
    return db;
  };

  it("com o hash válido, o hóspede abre a sessão e lê só a própria hospedagem", async () => {
    const db = await open("g-1");
    await assertSucceeds(getDoc(doc(db, `tenants/${A}/stays/s1`)));
    await assertSucceeds(getDoc(doc(db, `tenants/${A}/stays/s1/charges/c1`)));
    await assertSucceeds(getDoc(doc(db, `tenants/${A}/stays/s1/payments/p1`)));
  });

  it("hóspede não lê dados pessoais, outras hospedagens, nem lista nada", async () => {
    const db = await open("g-1");
    await assertFails(getDoc(doc(db, `tenants/${A}/guests/g1`)));
    await assertFails(getDoc(doc(db, `tenants/${A}/accountsPayable/ap1`)));
    await assertFails(getDocs(collection(db, `tenants/${A}/stays`)));
    await assertFails(getDoc(doc(db, `tenants/${B}/stays/s1`)));
  });

  it("hóspede não altera preços, lançamentos nem pagamentos", async () => {
    const db = await open("g-1");
    await assertFails(updateDoc(doc(db, `tenants/${A}/stays/s1`), { totalCents: 1 }));
    await assertFails(updateDoc(doc(db, `tenants/${A}/stays/s1/charges/c1`), { totalCents: 1 }));
    await assertFails(setDoc(doc(db, `tenants/${A}/stays/s1/payments/pg`), { amountCents: 60000, kind: "payment", createdBy: "g-1" }));
    await assertFails(updateDoc(doc(db, `tenants/${A}/stayAccess/${HASH}`), { status: "active" }));
  });

  it("sem conhecer o hash não há sessão nem acesso", async () => {
    const db = guest("g-2");
    await assertFails(setDoc(doc(db, `tenants/${A}/stayAccess/${"d".repeat(64)}/sessions/g-2`), { x: 1 }));
    await assertFails(getDoc(doc(db, `tenants/${A}/stays/s1`)));
  });

  it("o hash de uma pousada não abre a hospedagem de outra", async () => {
    const db = await open("g-1");
    await assertFails(getDoc(doc(db, `tenants/${B}/stays/s1`)));
    await assertFails(setDoc(doc(db, `tenants/${B}/stayAccess/${HASH}/sessions/g-1`), { x: 1 }));
  });

  it("chat nos dois sentidos; hóspede não se passa pela recepção", async () => {
    const g = await open("g-1");
    await assertSucceeds(setDoc(doc(g, `tenants/${A}/stays/s1/messages/m1`), { sender: "guest", text: "Olá", createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(g, `tenants/${A}/stays/s1/messages/m2`), { sender: "staff", senderUid: "g-1", text: "x", createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(g, `tenants/${A}/stays/s1/messages/m3`), { sender: "guest", text: "", createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(g, `tenants/${A}/stays/s1/messages/m4`), { sender: "guest", text: "x".repeat(2001), createdAt: serverTimestamp() }));
    const s = staff(A, "reception");
    await assertSucceeds(setDoc(doc(s, `tenants/${A}/stays/s1/messages/m5`), { sender: "staff", senderUid: `${A}-reception`, text: "Bem-vindo", createdAt: serverTimestamp() }));
    await assertSucceeds(getDoc(doc(g, `tenants/${A}/stays/s1/messages/m5`)));
    await assertFails(updateDoc(doc(g, `tenants/${A}/stays/s1/messages/m1`), { text: "adulterada" }));
  });

  it("quem não é membro nem hóspede não escreve mensagem", async () => {
    const intruso = env.authenticatedContext("intruso", { email_verified: true }).firestore();
    await assertFails(setDoc(doc(intruso, `tenants/${A}/stays/s1/messages/mx`), { sender: "staff", senderUid: "intruso", text: "oi", createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(staff(B, "owner"), `tenants/${A}/stays/s1/messages/my`), { sender: "staff", senderUid: `${B}-owner`, text: "oi", createdAt: serverTimestamp() }));
  });

  it("revogar o QR Code derruba o acesso imediatamente, inclusive de sessão aberta", async () => {
    const g = await open("g-1");
    await assertSucceeds(getDoc(doc(g, `tenants/${A}/stays/s1`)));
    await assertSucceeds(updateDoc(doc(staff(A, "reception"), `tenants/${A}/stayAccess/${HASH}`), { status: "revoked" }));
    await assertFails(getDoc(doc(g, `tenants/${A}/stays/s1`)));
    await assertFails(getDoc(doc(g, `tenants/${A}/stays/s1/charges/c1`)));
    await assertFails(setDoc(doc(g, `tenants/${A}/stays/s1/messages/mz`), { sender: "guest", text: "oi", createdAt: serverTimestamp() }));
  });

  it("código revogado não permite abrir nova sessão nem reativar", async () => {
    await assertSucceeds(updateDoc(doc(staff(A, "reception"), `tenants/${A}/stayAccess/${HASH}`), { status: "revoked" }));
    const db = guest("g-3");
    await assertFails(setDoc(doc(db, `tenants/${A}/stayAccess/${HASH}/sessions/g-3`), { x: 1 }));
    await assertFails(updateDoc(doc(staff(A, "reception"), `tenants/${A}/stayAccess/${HASH}`), { status: "active" }));
  });

  it("novo check-in no mesmo quarto usa um novo hash e o antigo não serve", async () => {
    const NEW = "e".repeat(64);
    const rec = staff(A, "reception");
    await assertSucceeds(updateDoc(doc(rec, `tenants/${A}/stayAccess/${HASH}`), { status: "revoked" }));
    await assertSucceeds(setDoc(doc(rec, `tenants/${A}/stayAccess/${NEW}`), { stayId: "s2", status: "active" }));
    await assertSucceeds(setDoc(doc(rec, `tenants/${A}/stays/s2`), { status: "active", roomId: "r1", guestId: "g1", accessHash: NEW, createdBy: `${A}-reception` }));
    const velho = guest("g-old");
    await assertFails(setDoc(doc(velho, `tenants/${A}/stayAccess/${HASH}/sessions/g-old`), { x: 1 }));
    const novo = await open("g-new", NEW);
    await assertSucceeds(getDoc(doc(novo, `tenants/${A}/stays/s2`)));
    await assertFails(getDoc(doc(novo, `tenants/${A}/stays/s1`)));
  });

  it("o hash armazenado nunca pode ser listado nem apagado", async () => {
    const g = await open("g-1");
    await assertFails(getDocs(collection(g, `tenants/${A}/stayAccess`)));
    await assertFails(deleteDoc(doc(staff(A, "owner"), `tenants/${A}/stayAccess/${HASH}`)));
  });
});
