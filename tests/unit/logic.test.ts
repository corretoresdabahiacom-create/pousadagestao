import { describe, expect, it } from "vitest";
import { dreCaixa, dreCompetencia, splitInstallments, type CashEntry, type Payable, type Revenue } from "../../src/lib/finance";
import { toCsv } from "../../src/lib/exporters";
import { countNights } from "../../src/lib/format";
import { parseBRLToCents } from "../../src/lib/money";

const d = (s: string) => new Date(`${s}T12:00:00`);
const from = d("2026-11-01"), to = d("2026-12-01");

describe("parcelas", () => {
  it("soma exata em centavos, diferença na última", () => {
    const p = splitInstallments(10000, 3);
    expect(p).toEqual([3333, 3333, 3334]);
    expect(p.reduce((a, b) => a + b, 0)).toBe(10000);
  });
});

describe("DRE", () => {
  const rev: Revenue[] = [{ id: "1", kind: "stay_closing", description: "", date: d("2026-11-10"), grossCents: 100000, deductionsCents: 10000, lines: [{ category: "Hospedagem", cents: 90000 }, { category: "Alimentação e bebidas", cents: 10000 }] }];
  const pay = (over: Partial<Payable>): Payable => ({ id: "p", supplier: "", description: "", category: "Energia", amountCents: 20000, dueDate: d("2026-12-05"), competenceDate: d("2026-11-20"), status: "open", ...over });
  it("competência: receita líquida de descontos e despesa pela competência, mesmo sem pagar", () => {
    const r = dreCompetencia(rev, [pay({}), pay({ id: "q", status: "cancelled" }), pay({ id: "z", competenceDate: d("2026-10-02") })], from, to);
    expect(r.revenueCents).toBe(90000);
    expect(r.expenseCents).toBe(20000);
    expect(r.resultCents).toBe(70000);
  });
  it("avisa despesa sem categoria e período sem dados", () => {
    expect(dreCompetencia(rev, [pay({ category: "Não classificado" })], from, to).warnings.length).toBe(1);
    expect(dreCompetencia([], [], from, to).warnings.length).toBe(1);
  });
  it("caixa: ignora transferências e trata estorno como redução de receita", () => {
    const e = (over: Partial<CashEntry>): CashEntry => ({ id: "x", kind: "in", amountCents: 1000, category: "Hospedagem", description: "", at: d("2026-11-05"), transfer: false, ...over });
    const r = dreCaixa([e({}), e({ transfer: true, amountCents: 99999 }), e({ kind: "out", source: "stay", amountCents: 300 }), e({ kind: "out", category: "Energia", amountCents: 400 })], from, to);
    expect(r.revenueCents).toBe(700);
    expect(r.expenseCents).toBe(400);
  });
});

describe("exportação", () => {
  it("CSV neutraliza fórmulas e formata dinheiro", () => {
    const csv = toCsv({ title: "t", headers: ["a", "v"], moneyCols: [1], rows: [["=SOMA(A1)", 12345]] });
    expect(csv).toContain("'=SOMA(A1)");
    expect(csv).toContain("123,45");
  });
});

describe("regra de 24 h e dinheiro", () => {
  it("conta diárias por períodos de 24 h, mínimo 1", () => {
    const a = new Date("2026-11-01T15:00:00");
    expect(countNights(a, new Date("2026-11-02T14:00:00"))).toBe(1);
    expect(countNights(a, new Date("2026-11-02T16:00:00"))).toBe(2);
    expect(countNights(a, a)).toBe(1);
  });
  it("lê valores em reais para centavos", () => {
    expect(parseBRLToCents("1.234,56")).toBe(123456);
    expect(parseBRLToCents("abc")).toBeNull();
  });
});
