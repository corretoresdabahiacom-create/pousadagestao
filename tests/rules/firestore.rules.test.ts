import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { Timestamp, deleteDoc, doc, getDoc, getDocs, collection, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";

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
      await setDoc(doc(db, `tenants/${t}/stays/s1`), { ...stayData(h), totalCents: 60000 });
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


/** Documento de hospedagem completo e coerente (3 diárias de R$ 200,00). */
const TS_IN = Timestamp.fromDate(new Date("2026-11-01T15:00:00Z"));
const TS_OUT = Timestamp.fromDate(new Date("2026-11-04T15:00:00Z"));
const stayData = (hash: string, over: Record<string, unknown> = {}, room = "r1", uid = "x") => ({
  status: "active", roomId: room, roomNumber: "1", guestId: "g1", guestName: "Hóspede", guestPhone: "7199999999",
  accessHash: hash, checkInAt: TS_IN, plannedCheckOutAt: TS_OUT, nights: 3, dailyRateCents: 20000, lodgingCents: 60000,
  discountCents: 0, feesCents: 0, totalPlannedCents: 60000, companionsCount: 0, createdBy: uid, ...over,
});

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

/** Pagamento + lançamento de caixa acoplado, no mesmo lote (como o app faz). */
function payBatch(db: ReturnType<typeof staff>, key: string, amount: number, uid: string, over: { cashAmount?: number; stayId?: string; kind?: "payment" | "refund" } = {}) {
  const stayId = over.stayId ?? "s1";
  const kind = over.kind ?? "payment";
  const b = writeBatch(db);
  b.set(doc(db, `tenants/${A}/stays/${stayId}/payments/${key}`), { kind, amountCents: amount, method: "pix", note: "", createdBy: uid, createdAt: serverTimestamp() });
  b.set(doc(db, `tenants/${A}/cashEntries/stay-${key}`), { kind: kind === "payment" ? "in" : "out", amountCents: over.cashAmount ?? amount, method: "pix", source: "stay", stayId, paymentKey: key, category: "Hospedagem", description: "t", transfer: false, createdBy: uid, at: serverTimestamp() });
  return b.commit();
}

describe("integridade financeira", () => {
  it("pagamento é imutável e o mesmo ID não pode ser criado duas vezes (idempotência)", async () => {
    const db = staff(A, "reception");
    await assertSucceeds(payBatch(db, "idem-1", 5000, `${A}-reception`));
    await assertFails(payBatch(db, "idem-1", 5000, `${A}-reception`));
    await assertFails(updateDoc(doc(db, `tenants/${A}/stays/s1/payments/p1`), { amountCents: 1 }));
    await assertFails(deleteDoc(doc(db, `tenants/${A}/stays/s1/payments/p1`)));
  });

  it("pagamento exige valor positivo e autoria verdadeira", async () => {
    const db = staff(A, "reception");
    await assertFails(payBatch(db, "x1", -5, `${A}-reception`));
    await assertFails(payBatch(db, "x2", 5.5, `${A}-reception`));
    await assertFails(payBatch(db, "x3", 100, "outro"));
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
    // observação não é mais campo da hospedagem
    await assertFails(updateDoc(doc(staff(A, "reception"), `tenants/${A}/stays/s1`), { notes: "ok" }));
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
    const b = writeBatch(rec);
    b.set(doc(rec, `tenants/${A}/stayAccess/${NEW}`), { stayId: "s2", status: "active" });
    b.update(doc(rec, `tenants/${A}/rooms/r1`), { status: "occupied", currentStayId: "s2", updatedAt: serverTimestamp() });
    b.set(doc(rec, `tenants/${A}/stays/s2`), { ...stayData(NEW, {}, "r1", `${A}-reception`), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await assertSucceeds(b.commit());
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

// ---------------------------------------------------------------------------
// Fases 4–9: check-in, checkout, financeiro, limpeza, plano e suspensão
// ---------------------------------------------------------------------------

describe("check-in atômico (quarto + QR + hospedagem no mesmo lote)", () => {
  const NEW = "c".repeat(64);
  const checkin = (db: ReturnType<typeof staff>, room: string, over: { occupy?: boolean; hash?: string } = {}) => {
    const b = writeBatch(db);
    b.set(doc(db, `tenants/${A}/stayAccess/${NEW}`), { stayId: "s9", status: "active" });
    if (over.occupy !== false) b.update(doc(db, `tenants/${A}/rooms/${room}`), { status: "occupied", currentStayId: "s9", updatedAt: serverTimestamp() });
    b.set(doc(db, `tenants/${A}/stays/s9`), { ...stayData(over.hash ?? NEW, {}, room, `${A}-reception`), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return b.commit();
  };

  it("recepção faz check-in em quarto disponível", async () => {
    await assertSucceeds(checkin(staff(A, "reception"), "r1"));
  });
  it("não permite check-in em quarto já ocupado (sem dupla reserva)", async () => {
    await assertFails(checkin(staff(A, "reception"), "r2"));
  });
  it("não permite criar a hospedagem sem marcar o quarto como ocupado", async () => {
    await assertFails(checkin(staff(A, "reception"), "r1", { occupy: false }));
  });
  it("não permite hospedagem apontando para um QR diferente do criado no lote", async () => {
    await assertFails(checkin(staff(A, "reception"), "r1", { hash: "d".repeat(64) }));
  });
  it("financeiro e funcionário não fazem check-in", async () => {
    await assertFails(checkin(staff(A, "finance"), "r1"));
    await assertFails(checkin(staff(A, "staff"), "r1"));
  });
});

describe("reemissão do QR Code", () => {
  const NEW = "f".repeat(64);
  it("com o código antigo revogado e o novo ativo no mesmo lote", async () => {
    const db = staff(A, "reception");
    const b = writeBatch(db);
    b.update(doc(db, `tenants/${A}/stayAccess/${HASH}`), { status: "revoked" });
    b.set(doc(db, `tenants/${A}/stayAccess/${NEW}`), { stayId: "s1", status: "active" });
    b.update(doc(db, `tenants/${A}/stays/s1`), { accessHash: NEW });
    await assertSucceeds(b.commit());
  });
  it("trocar o código sem revogar o antigo é negado", async () => {
    const db = staff(A, "reception");
    const b = writeBatch(db);
    b.set(doc(db, `tenants/${A}/stayAccess/${NEW}`), { stayId: "s1", status: "active" });
    b.update(doc(db, `tenants/${A}/stays/s1`), { accessHash: NEW });
    await assertFails(b.commit());
  });
});

describe("checkout em lote", () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), `tenants/${A}/rooms/r1`), { status: "occupied", currentStayId: "s1" });
    });
  });
  const checkout = (db: ReturnType<typeof staff>, uid: string, over: { revoke?: boolean } = {}) => {
    const b = writeBatch(db);
    if (over.revoke !== false) b.update(doc(db, `tenants/${A}/stayAccess/${HASH}`), { status: "revoked" });
    b.set(doc(db, `tenants/${A}/revenues/checkout-s1`), { kind: "stay_closing", stayId: "s1", grossCents: 60000, deductionsCents: 0, date: serverTimestamp(), createdBy: uid, lines: [] });
    b.set(doc(db, `tenants/${A}/accountsReceivable/stay-s1`), { amountCents: 1000, receivedCents: 0, status: "open", stayId: "s1", createdBy: uid });
    b.set(doc(db, `tenants/${A}/cleaningTasks/clean-s1`), { roomId: "r1", status: "pending", createdBy: uid });
    b.update(doc(db, `tenants/${A}/rooms/r1`), { status: "awaiting_cleaning", currentStayId: null, updatedAt: serverTimestamp() });
    b.update(doc(db, `tenants/${A}/stays/s1`), { status: "closed", checkedOutAt: serverTimestamp(), closing: { pendingCents: 1000 } });
    return b.commit();
  };
  it("recepção encerra a hospedagem revogando o QR no mesmo lote", async () => {
    await assertSucceeds(checkout(staff(A, "reception"), `${A}-reception`));
  });
  it("encerrar sem revogar o QR é negado", async () => {
    await assertFails(checkout(staff(A, "reception"), `${A}-reception`, { revoke: false }));
  });
  it("funcionário não encerra hospedagem", async () => {
    await assertFails(checkout(staff(A, "staff"), `${A}-staff`));
  });
  it("hospedagem encerrada não reabre", async () => {
    await assertSucceeds(checkout(staff(A, "reception"), `${A}-reception`));
    await assertFails(updateDoc(doc(staff(A, "reception"), `tenants/${A}/stays/s1`), { status: "active" }));
  });
});

const manualIn = (db: ReturnType<typeof staff>, key: string, amount: number, uid: string, over: { revenue?: boolean; revAmount?: number; transfer?: boolean } = {}) => {
  const b = writeBatch(db);
  b.set(doc(db, `tenants/${A}/cashEntries/manual-${key}`), { kind: "in", amountCents: amount, method: "dinheiro", source: "manual", category: "Serviços", description: "d", transfer: over.transfer === true, at: serverTimestamp(), createdBy: uid });
  if (over.revenue !== false) b.set(doc(db, `tenants/${A}/revenues/manual-${key}`), { kind: "manual", description: "d", grossCents: over.revAmount ?? amount, deductionsCents: 0, date: serverTimestamp(), lines: [], createdBy: uid });
  return b.commit();
};
const openReg = (db: ReturnType<typeof staff>, id: string, uid: string) => {
  const b = writeBatch(db);
  b.set(doc(db, `tenants/${A}/cashRegisters/${id}`), { status: "open", openingCents: 1000, openedBy: uid, openedAt: serverTimestamp() });
  b.set(doc(db, `tenants/${A}/registerLock/current`), { registerId: id });
  return b.commit();
};
const closeReg = (db: ReturnType<typeof staff>, id: string, uid: string, over: { counted?: number; expected?: number; diff?: number; keepLock?: boolean } = {}) => {
  const b = writeBatch(db);
  const counted = over.counted ?? 900, expected = over.expected ?? 1000;
  b.update(doc(db, `tenants/${A}/cashRegisters/${id}`), { status: "closed", closedAt: serverTimestamp(), closedBy: uid, countedCents: counted, expectedCents: expected, differenceCents: over.diff ?? counted - expected, note: "" });
  if (!over.keepLock) b.delete(doc(db, `tenants/${A}/registerLock/current`));
  return b.commit();
};

describe("caixa e razão financeiro", () => {
  it("financeiro abre e fecha o caixa; recepção não abre", async () => {
    const fin = staff(A, "finance");
    await assertSucceeds(openReg(fin, "c1", `${A}-finance`));
    await assertFails(openReg(staff(A, "reception"), "c2", `${A}-reception`));
    await assertSucceeds(closeReg(fin, "c1", `${A}-finance`));
  });
  it("só um caixa aberto por vez; depois de fechar, pode abrir outro", async () => {
    const fin = staff(A, "finance");
    await assertSucceeds(openReg(fin, "c1", `${A}-finance`));
    await assertFails(openReg(fin, "c2", `${A}-finance`));
    await assertSucceeds(closeReg(fin, "c1", `${A}-finance`));
    await assertSucceeds(openReg(fin, "c3", `${A}-finance`));
  });
  it("fechamento exige diferença correta e liberar a trava", async () => {
    const fin = staff(A, "finance");
    await assertSucceeds(openReg(fin, "c1", `${A}-finance`));
    await assertFails(closeReg(fin, "c1", `${A}-finance`, { diff: 0 }));
    await assertFails(closeReg(fin, "c1", `${A}-finance`, { keepLock: true }));
    await assertSucceeds(closeReg(fin, "c1", `${A}-finance`));
  });
  it("caixa fechado não reabre e a abertura não muda", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `tenants/${A}/cashRegisters/c3`), { status: "closed", openingCents: 100 });
      await setDoc(doc(ctx.firestore(), `tenants/${A}/cashRegisters/c4`), { status: "open", openingCents: 100 });
    });
    const fin = staff(A, "finance");
    await assertFails(updateDoc(doc(fin, `tenants/${A}/cashRegisters/c3`), { status: "open" }));
    await assertFails(updateDoc(doc(fin, `tenants/${A}/cashRegisters/c4`), { status: "closed", openingCents: 99999 }));
  });
  it("lançamentos de caixa: criam-se com autoria e valor positivo, e nunca mudam", async () => {
    const fin = staff(A, "finance");
    const ok = { kind: "out", amountCents: 700, method: "dinheiro", source: "manual", category: "x", description: "d", transfer: false, at: serverTimestamp(), createdBy: `${A}-finance` };
    await assertSucceeds(setDoc(doc(fin, `tenants/${A}/cashEntries/manual-e1`), ok));
    await assertFails(setDoc(doc(fin, `tenants/${A}/cashEntries/manual-e2`), { ...ok, amountCents: 0 }));
    await assertFails(setDoc(doc(fin, `tenants/${A}/cashEntries/manual-e3`), { ...ok, createdBy: "outro" }));
    await assertFails(setDoc(doc(fin, `tenants/${A}/cashEntries/manual-e4`), { ...ok, kind: "transfer" }));
    await assertFails(setDoc(doc(fin, `tenants/${A}/cashEntries/solto`), ok)); // id fora do formato
    await assertFails(updateDoc(doc(fin, `tenants/${A}/cashEntries/manual-e1`), { amountCents: 1 }));
    await assertFails(deleteDoc(doc(staff(A, "owner"), `tenants/${A}/cashEntries/manual-e1`)));
  });
  it("funcionário e hóspede não leem nem gravam no financeiro", async () => {
    await assertFails(getDocs(collection(staff(A, "staff"), `tenants/${A}/cashEntries`)));
    await assertFails(setDoc(doc(staff(A, "staff"), `tenants/${A}/cashEntries/x`), { kind: "in", amountCents: 1, at: serverTimestamp(), createdBy: `${A}-staff` }));
    const g = guest("g-fin");
    await setDoc(doc(g, `tenants/${A}/stayAccess/${HASH}/sessions/g-fin`), { createdAt: serverTimestamp() });
    await assertFails(getDocs(collection(g, `tenants/${A}/cashEntries`)));
    await assertFails(getDocs(collection(g, `tenants/${A}/accountsPayable`)));
  });
  it("receitas reconhecidas são imutáveis", async () => {
    const fin = staff(A, "finance");
    await assertSucceeds(manualIn(fin, "r1", 1000, `${A}-finance`));
    await assertFails(updateDoc(doc(fin, `tenants/${A}/revenues/manual-r1`), { grossCents: 1 }));
    await assertFails(deleteDoc(doc(fin, `tenants/${A}/revenues/manual-r1`)));
  });
  it("conta paga fica travada (valor não muda)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `tenants/${A}/accountsPayable/ap2`), { amountCents: 5000, status: "paid", createdBy: "x" });
    });
    await assertFails(updateDoc(doc(staff(A, "finance"), `tenants/${A}/accountsPayable/ap2`), { amountCents: 1 }));
    await assertFails(updateDoc(doc(staff(A, "finance"), `tenants/${A}/accountsPayable/ap2`), { status: "open" }));
  });
});

describe("limpeza", () => {
  it("funcionário segue aguardando → em limpeza → disponível, e só isso", async () => {
    const st = staff(A, "staff");
    await assertSucceeds(updateDoc(doc(st, `tenants/${A}/rooms/r3`), { status: "cleaning", updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(st, `tenants/${A}/rooms/r4`), { status: "available", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(st, `tenants/${A}/rooms/r1`), { status: "maintenance", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(st, `tenants/${A}/rooms/r2`), { status: "available", updatedAt: serverTimestamp() }));
  });
  it("recepção não altera o estado de limpeza do quarto", async () => {
    await assertFails(updateDoc(doc(staff(A, "reception"), `tenants/${A}/rooms/r3`), { status: "cleaning", updatedAt: serverTimestamp() }));
  });
});

describe("planos, limites e suspensão", () => {
  it("proprietário não altera plano, status nem limites", async () => {
    const o = staff(A, "owner");
    await assertFails(updateDoc(doc(o, `tenants/${A}`), { planId: "premium" }));
    await assertFails(updateDoc(doc(o, `tenants/${A}`), { status: "active", limits: { maxRooms: 999 } }));
  });
  it("não é possível criar a pousada já com limites próprios", async () => {
    const db = env.authenticatedContext("u-lim", { email_verified: true }).firestore();
    const b = writeBatch(db);
    b.set(doc(db, "tenants/lim"), { name: "L", ownerUid: "u-lim", planId: "trial", status: "trial", limits: { maxRooms: 999 } });
    b.set(doc(db, "tenants/lim/members/u-lim"), { role: "owner", active: true });
    await assertFails(b.commit());
  });
  it("administrador da plataforma altera plano e suspende; os demais não", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), "platformAdmins/root"), { x: 1 }); });
    const root = env.authenticatedContext("root", { email_verified: true }).firestore();
    await assertSucceeds(updateDoc(doc(root, `tenants/${A}`), { planId: "premium", limits: { maxRooms: 50 } }));
    await assertSucceeds(updateDoc(doc(root, `tenants/${A}`), { status: "suspended" }));
    await assertFails(updateDoc(doc(staff(B, "owner"), `tenants/${B}`), { status: "suspended" }));
  });
  it("pousada suspensa também derruba o acesso do hóspede", async () => {
    const g = guest("g-susp");
    await setDoc(doc(g, `tenants/${A}/stayAccess/${HASH}/sessions/g-susp`), { createdAt: serverTimestamp() });
    await assertSucceeds(getDoc(doc(g, `tenants/${A}/stays/s1`)));
    await env.withSecurityRulesDisabled(async (ctx) => { await updateDoc(doc(ctx.firestore(), `tenants/${A}`), { status: "suspended" }); });
    await assertFails(getDoc(doc(g, `tenants/${A}/stays/s1`)));
  });
});

// ---------------------------------------------------------------------------
// Fase 1 — segurança: observações internas, campos da hospedagem, coleção platform
// ---------------------------------------------------------------------------
describe("fase 1 — dados internos e campos da hospedagem", () => {
  it("observação interna: equipe lê; hóspede nunca", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `tenants/${A}/stayNotes/s1`), { text: "só equipe", createdBy: "x" });
    });
    await assertSucceeds(getDoc(doc(staff(A, "reception"), `tenants/${A}/stayNotes/s1`)));
    await assertFails(getDoc(doc(staff(A, "staff"), `tenants/${A}/stayNotes/s1`)));
    const g = guest("g-n");
    await setDoc(doc(g, `tenants/${A}/stayAccess/${HASH}/sessions/g-n`), { createdAt: serverTimestamp() });
    await assertSucceeds(getDoc(doc(g, `tenants/${A}/stays/s1`)));
    await assertFails(getDoc(doc(g, `tenants/${A}/stayNotes/s1`)));
    await assertFails(setDoc(doc(g, `tenants/${A}/stayNotes/s1`), { text: "x", createdBy: "g-n" }));
  });

  it("recepção não altera diária, desconto, taxas, entrada, nome nem telefone", async () => {
    const ref = doc(staff(A, "reception"), `tenants/${A}/stays/s1`);
    for (const change of [
      { dailyRateCents: 1 }, { discountCents: 59999 }, { feesCents: 5 }, { checkInAt: TS_OUT },
      { guestName: "Outro" }, { guestPhone: "0" }, { totalPlannedCents: 1 }, { companionsCount: 9 }, { roomId: "r2" },
    ]) await assertFails(updateDoc(ref, change));
  });

  it("prorrogação válida passa; com total ou diárias incoerentes é negada", async () => {
    const ref = doc(staff(A, "reception"), `tenants/${A}/stays/s1`);
    const out5 = Timestamp.fromDate(new Date("2026-11-06T15:00:00Z"));
    await assertFails(updateDoc(ref, { plannedCheckOutAt: out5, nights: 5, lodgingCents: 100000, totalPlannedCents: 1, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { plannedCheckOutAt: out5, nights: 5, lodgingCents: 1, totalPlannedCents: 1, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { plannedCheckOutAt: TS_IN, nights: 5, lodgingCents: 100000, totalPlannedCents: 100000, updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { plannedCheckOutAt: out5, nights: 5, lodgingCents: 100000, totalPlannedCents: 100000, updatedAt: serverTimestamp() }));
  });

  it("check-in com totais incoerentes ou campos extras é negado", async () => {
    const mk = (over: Record<string, unknown>) => {
      const db = staff(A, "reception");
      const b = writeBatch(db);
      const H = "e".repeat(64);
      b.set(doc(db, `tenants/${A}/stayAccess/${H}`), { stayId: "s7", status: "active" });
      b.update(doc(db, `tenants/${A}/rooms/r1`), { status: "occupied", currentStayId: "s7", updatedAt: serverTimestamp() });
      b.set(doc(db, `tenants/${A}/stays/s7`), { ...stayData(H, over, "r1", `${A}-reception`), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      return b.commit();
    };
    await assertFails(mk({ totalPlannedCents: 1 }));
  });
  it("check-in com campo extra (ex.: notes) é negado", async () => {
    const db = staff(A, "reception");
    const b = writeBatch(db);
    const H = "e".repeat(64);
    b.set(doc(db, `tenants/${A}/stayAccess/${H}`), { stayId: "s8", status: "active" });
    b.update(doc(db, `tenants/${A}/rooms/r1`), { status: "occupied", currentStayId: "s8", updatedAt: serverTimestamp() });
    b.set(doc(db, `tenants/${A}/stays/s8`), { ...stayData(H, { notes: "vazou" }, "r1", `${A}-reception`), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await assertFails(b.commit());
  });

  it("coleção platform: só o administrador da plataforma lê e grava", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "platformAdmins/root2"), { x: 1 });
      await setDoc(doc(ctx.firestore(), "platform/plan-x"), { type: "plan", name: "X", maxRooms: 5 });
      await setDoc(doc(ctx.firestore(), "platform/log1"), { type: "log", tenantId: A });
    });
    const g = guest("g-p");
    await assertFails(getDoc(doc(g, "platform/plan-x")));
    await assertFails(getDocs(collection(g, "platform")));
    await assertFails(getDoc(doc(staff(A, "owner"), "platform/log1")));
    const root = env.authenticatedContext("root2", { email_verified: true }).firestore();
    await assertSucceeds(getDocs(collection(root, "platform")));
    await assertSucceeds(setDoc(doc(root, "platform/plan-y"), { type: "plan", name: "Y", maxRooms: 9 }));
  });
});

describe("fase 2 — integridade financeira acoplada", () => {
  it("pagamento exige o lançamento de caixa do mesmo valor, no mesmo lote", async () => {
    const db = staff(A, "reception");
    await assertSucceeds(payBatch(db, "ok-1", 3000, `${A}-reception`));
    await assertFails(payBatch(db, "bad-1", 3000, `${A}-reception`, { cashAmount: 2999 }));
    await assertFails(setDoc(doc(db, `tenants/${A}/stays/s1/payments/sozinho`), { kind: "payment", amountCents: 100, method: "pix", note: "", createdBy: `${A}-reception`, createdAt: serverTimestamp() }));
  });
  it("estorno vira saída de caixa; não há pagamento em hospedagem encerrada", async () => {
    const db = staff(A, "reception");
    await assertSucceeds(payBatch(db, "rf-1", 500, `${A}-reception`, { kind: "refund" }));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `tenants/${A}/stays/sc`), { status: "closed", accessHash: "z".repeat(64) });
    });
    await assertFails(payBatch(db, "late-1", 500, `${A}-reception`, { stayId: "sc" }));
  });
  it("lançamento de caixa de hospedagem sem pagamento correspondente é negado", async () => {
    const db = staff(A, "reception");
    await assertFails(setDoc(doc(db, `tenants/${A}/cashEntries/stay-fantasma`), { kind: "in", amountCents: 100, method: "pix", source: "stay", stayId: "s1", paymentKey: "fantasma", category: "Hospedagem", description: "t", transfer: false, createdBy: `${A}-reception`, at: serverTimestamp() }));
  });
  it("entrada manual gera receita; transferência não; valores precisam bater", async () => {
    const fin = staff(A, "finance");
    await assertSucceeds(manualIn(fin, "m1", 800, `${A}-finance`));
    await assertFails(manualIn(fin, "m2", 800, `${A}-finance`, { revenue: false }));
    await assertFails(manualIn(fin, "m3", 800, `${A}-finance`, { revAmount: 700 }));
    await assertSucceeds(manualIn(fin, "m4", 800, `${A}-finance`, { revenue: false, transfer: true }));
  });
  it("pagar conta exige a saída de caixa e o mesmo valor", async () => {
    const fin = staff(A, "finance");
    const pay = (amount: number, withCash = true) => {
      const b = writeBatch(fin);
      b.update(doc(fin, `tenants/${A}/accountsPayable/ap1`), { status: "paid", paidAt: Timestamp.now(), method: "pix", paidBy: `${A}-finance` });
      if (withCash) b.set(doc(fin, `tenants/${A}/cashEntries/pay-ap1`), { kind: "out", amountCents: amount, method: "pix", source: "payable", payableId: "ap1", category: "x", description: "d", transfer: false, createdBy: `${A}-finance`, at: serverTimestamp() });
      return b.commit();
    };
    await assertFails(pay(5000, false));
    await assertFails(pay(4000));
    await assertSucceeds(pay(5000));
  });
  describe("contas a receber", () => {
    beforeEach(async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), `tenants/${A}/accountsReceivable/ar1`), { amountCents: 1000, receivedCents: 0, status: "open", customerName: "X", createdBy: "x" });
      });
    });
    const receive = (db: ReturnType<typeof staff>, key: string, total: number, status: string, cash: number | null) => {
      const b = writeBatch(db);
      b.update(doc(db, `tenants/${A}/accountsReceivable/ar1`), { receivedCents: total, status, lastReceivedAt: serverTimestamp(), lastReceiptKey: key });
      if (cash !== null) b.set(doc(db, `tenants/${A}/cashEntries/rcv-ar1-${key}`), { kind: "in", amountCents: cash, method: "pix", source: "receivable", receivableId: "ar1", receiptKey: key, category: "Hospedagem", description: "d", transfer: false, createdBy: `${A}-finance`, at: serverTimestamp() });
      return b.commit();
    };
    it("recebimento parcial e total acoplados ao caixa", async () => {
      const fin = staff(A, "finance");
      await assertSucceeds(receive(fin, "k1", 400, "open", 400));
      await assertSucceeds(receive(fin, "k2", 1000, "received", 600));
    });
    it("nega valor acima do saldo, status incoerente, recuo e recebimento sem caixa", async () => {
      const fin = staff(A, "finance");
      await assertFails(receive(fin, "k1", 1200, "received", 1200));
      await assertFails(receive(fin, "k1", 400, "received", 400));
      await assertFails(receive(fin, "k1", 400, "open", 300));
      await assertFails(receive(fin, "k1", 400, "open", null));
      await assertFails(receive(fin, "k1", 0, "open", 0));
    });
    it("recepção não recebe título", async () => {
      await assertFails(receive(staff(A, "reception"), "k1", 400, "open", 400));
    });
  });
});
