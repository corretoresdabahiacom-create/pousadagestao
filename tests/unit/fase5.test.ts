import { describe, expect, it } from "vitest";
import { addMonths, expectedCash, splitInstallments, type CashEntry, type Register } from "../../src/lib/finance";
import { computeAccount, computePlanned, parseCharge, parsePayment, parseStay } from "../../src/lib/stays";
import { addNights, countNights, DAY_MS, fmtDate, fmtDateTime, monthKey, setDisplayTimezone } from "../../src/lib/format";
import { formatCents, parseBRLToCents } from "../../src/lib/money";
import { generateToken, portalUrl, sha256Hex } from "../../src/lib/tokens";

const stay = (over: Record<string, unknown> = {}) =>
  parseStay("s1", { status: "active", lodgingCents: 60000, feesCents: 0, discountCents: 0, nights: 3, dailyRateCents: 20000, ...over });
const charge = (id: string, total: number, status = "active") => parseCharge(id, { status, totalCents: total, quantity: 1, unitCents: total });
const pay = (id: string, amount: number, kind = "payment") => parsePayment(id, { kind, amountCents: amount, method: "pix" });

describe("conta da hospedagem", () => {
  it("planejado = diárias − desconto + taxas, nunca negativo", () => {
    expect(computePlanned(20000, 3, 5000, 1000)).toEqual({ lodging: 60000, total: 56000 });
    expect(computePlanned(20000, 1, 99999, 0).total).toBe(0);
  });
  it("soma consumos ativos, ignora cancelados e calcula o saldo", () => {
    const a = computeAccount(stay({ discountCents: 1000, feesCents: 500 }), [charge("c1", 3000), charge("c2", 9999, "cancelled")], [pay("p1", 20000)]);
    expect(a.chargesCents).toBe(3000);
    expect(a.totalCents).toBe(60000 + 500 + 3000 - 1000);
    expect(a.paidCents).toBe(20000);
    expect(a.pendingCents).toBe(a.totalCents - 20000);
  });
  it("estorno reduz o recebido e pode gerar saldo negativo quando pagou a mais", () => {
    const a = computeAccount(stay(), [], [pay("p1", 70000), pay("r1", 5000, "refund")]);
    expect(a.paidCents).toBe(65000);
    expect(a.pendingCents).toBe(-5000);
  });
  it("sem lançamentos: saldo = total planejado", () => {
    const a = computeAccount(stay(), [], []);
    expect(a.pendingCents).toBe(60000);
  });
});

describe("caixa esperado", () => {
  const reg = (over: Partial<Register> = {}) => ({ id: "c", status: "open", openingCents: 10000, openedAt: new Date("2026-11-01T10:00:00"), ...over }) as Register;
  const e = (kind: "in" | "out", cents: number, at: string, over: Partial<CashEntry> = {}) =>
    ({ id: Math.random().toString(), kind, amountCents: cents, method: "dinheiro", transfer: false, at: new Date(at), ...over }) as CashEntry;
  it("abertura + entradas em dinheiro − saídas em dinheiro", () => {
    expect(expectedCash(reg(), [e("in", 5000, "2026-11-01T12:00:00"), e("out", 2000, "2026-11-01T13:00:00")])).toBe(13000);
  });
  it("ignora pix, transferências e lançamentos anteriores à abertura", () => {
    const list = [e("in", 9999, "2026-11-01T12:00:00", { method: "pix" }), e("in", 9999, "2026-11-01T12:00:00", { transfer: true }), e("in", 9999, "2026-10-01T12:00:00")];
    expect(expectedCash(reg(), list)).toBe(10000);
  });
  it("respeita o fechamento e não limita a 62 dias", () => {
    const r = reg({ openedAt: new Date("2026-01-01T00:00:00"), closedAt: new Date("2026-06-01T00:00:00") });
    expect(expectedCash(r, [e("in", 1000, "2026-03-01T00:00:00"), e("in", 1000, "2026-07-01T00:00:00")])).toBe(11000);
  });
});

describe("parcelas e meses", () => {
  it("a soma das parcelas é sempre o total, para vários valores e quantidades", () => {
    for (const total of [1, 99, 10000, 123457, 999999]) for (const n of [1, 2, 3, 7, 12]) {
      const parts = splitInstallments(total, n);
      expect(parts).toHaveLength(n);
      expect(parts.reduce((s, x) => s + x, 0)).toBe(total);
      expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(n);
    }
  });
  it("addMonths atravessa anos e preserva o dia quando possível", () => {
    const d = addMonths(new Date(2026, 10, 15, 9), 3);
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2027, 1, 15]);
    expect(addMonths(new Date(2026, 0, 31), 0).getDate()).toBe(31);
  });
});

describe("datas e fuso", () => {
  it("diárias de 24 h: 24h exatas = 1, 24h01 = 2, 0 h = 1", () => {
    const t0 = new Date("2026-11-01T10:00:00Z");
    expect(countNights(t0, new Date(t0.getTime() + DAY_MS))).toBe(1);
    expect(countNights(t0, new Date(t0.getTime() + DAY_MS + 60000))).toBe(2);
    expect(countNights(t0, t0)).toBe(1);
    expect(addNights(t0, 2).getTime() - t0.getTime()).toBe(2 * DAY_MS);
  });
  it("fuso da pousada muda a hora exibida; fuso inválido não quebra", () => {
    const d = new Date("2026-11-01T02:30:00Z");
    setDisplayTimezone("America/Sao_Paulo");
    expect(fmtDate(d)).toBe("31/10/2026");
    expect(fmtDate(d, "UTC")).toBe("01/11/2026");
    expect(fmtDateTime(d)).toContain("23:30");
    setDisplayTimezone("Fuso/Invalido");
    expect(() => fmtDate(d)).not.toThrow();
    setDisplayTimezone(undefined);
  });
  it("monthKey tem zero à esquerda", () => {
    expect(monthKey(new Date(2026, 2, 5))).toBe("2026-03");
  });
});

describe("dinheiro", () => {
  it("lê formatos brasileiros e recusa lixo", () => {
    expect(parseBRLToCents("1.234,56")).toBe(123456);
    expect(parseBRLToCents("R$ 10,00")).toBe(1000);
    expect(parseBRLToCents("abc")).toBeNull();
    expect(parseBRLToCents("")).toBeNull();
  });
  it("formata centavos em reais", () => {
    expect(formatCents(123456).replace(/\s/g, " ")).toContain("1.234,56");
    expect(formatCents(null)).toBeTruthy();
  });
});

describe("QR Code", () => {
  it("token tem 256 bits em base64url e nunca se repete", () => {
    const a = generateToken(), b = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
  it("hash SHA-256 conhecido (abc)", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("o token vai no fragmento, nunca na consulta", () => {
    Object.defineProperty(globalThis, "window", { value: { location: { origin: "https://x.test" } }, configurable: true });
    const u = portalUrl("pousada 1", "TOK");
    expect(u).toBe("https://x.test/h/?t=pousada%201#TOK");
    expect(u.split("#")[0]).not.toContain("TOK");
  });
});
