import { describe, expect, it } from "vitest";
import { checkoutMessage, waLink, waNumber } from "../../src/lib/whatsapp";
import { occupancyReport, type OccStay } from "../../src/lib/occupancy";

describe("WhatsApp", () => {
  it("normaliza telefones brasileiros e internacionais", () => {
    expect(waNumber("(71) 99999-8888")).toBe("5571999998888");
    expect(waNumber("71 3333-4444")).toBe("557133334444");
    expect(waNumber("+55 71 99999-8888")).toBe("5571999998888");
    expect(waNumber("071 99999-8888")).toBe("5571999998888");
    expect(waNumber("55 71 99999 8888")).toBe("5571999998888");
    expect(waNumber("+1 415 555 2671")).toBe("14155552671");
    expect(waNumber("0044 20 7946 0958")).toBe("442079460958");
  });
  it("recusa o que não é telefone", () => {
    expect(waNumber("")).toBeNull();
    expect(waNumber(undefined)).toBeNull();
    expect(waNumber("12345")).toBeNull();
    expect(waLink("abc", "oi")).toBeNull();
  });
  it("monta o link com a mensagem codificada", () => {
    const l = waLink("(71) 99999-8888", "Olá & até já");
    expect(l).toBe("https://wa.me/5571999998888?text=Ol%C3%A1%20%26%20at%C3%A9%20j%C3%A1");
  });
  it("mensagem usa o primeiro nome, o texto da pousada e o quarto", () => {
    const m = checkoutMessage({ guestName: "  Maria da Silva ", roomNumber: "7", checkOutAt: new Date(2026, 10, 20, 15), pousada: "Pousada Sol", text: "Esperamos que tenha gostado!" });
    expect(m.startsWith("Olá, Maria!")).toBe(true);
    expect(m).toContain("Esperamos que tenha gostado!");
    expect(m).toContain("quarto 7");
    expect(m).toContain("— Pousada Sol");
    expect(checkoutMessage({ guestName: "", roomNumber: "1", checkOutAt: new Date() }).startsWith("Olá!")).toBe(true);
  });
});

describe("ocupação (pousada 24 h)", () => {
  const D = (day: number, h = 0) => new Date(2026, 10, day, h);
  const st = (o: Partial<OccStay>): OccStay => ({ status: "closed", checkInAt: D(1, 12), plannedCheckOutAt: D(2, 12), checkedOutAt: D(2, 12), nights: 1, lodgingCents: 20000, discountCents: 0, ...o });

  it("uma diária das 12h às 12h vale meio quarto em cada dia e 1 quarto-diária no total", () => {
    const r = occupancyReport([st({})], 1, D(1), D(4), D(10));
    expect(r.days.map((d) => d.roomNights)).toEqual([0.5, 0.5, 0]);
    expect(r.roomNights).toBeCloseTo(1);
    expect(r.occupancy).toBeCloseTo(1 / 3);
    expect(r.revenueCents).toBe(20000);
    expect(r.adrCents).toBe(20000);
    expect(r.revparCents).toBe(6667);
  });
  it("hospedagem ativa conta até a saída prevista e aplica o desconto na receita", () => {
    const s = st({ status: "active", checkInAt: D(1), plannedCheckOutAt: D(3), checkedOutAt: null, nights: 2, lodgingCents: 40000, discountCents: 4000 });
    const r = occupancyReport([s], 2, D(1), D(4), D(2));
    expect(r.roomNights).toBeCloseTo(2);
    expect(r.revenueCents).toBe(36000);
    expect(r.adrCents).toBe(18000);
    expect(r.occupancy).toBeCloseTo(2 / 6);
  });
  it("hospedagem ativa que passou do horário conta até agora", () => {
    const s = st({ status: "active", checkInAt: D(1), plannedCheckOutAt: D(2), checkedOutAt: null });
    expect(occupancyReport([s], 1, D(1), D(5), D(3)).roomNights).toBeCloseTo(2);
  });
  it("ignora o que está fora do período e não divide por zero", () => {
    const r = occupancyReport([st({ checkInAt: D(20), checkedOutAt: D(21) })], 0, D(1), D(3), D(25));
    expect(r.roomNights).toBe(0);
    expect(r.occupancy).toBe(0);
    expect(r.adrCents).toBe(0);
    expect(r.revparCents).toBe(0);
  });
  it("vários quartos: ocupação nunca passa de 100% com quartos cheios", () => {
    const full = [1, 2, 3].map(() => st({ checkInAt: D(1), checkedOutAt: D(3), nights: 2, lodgingCents: 30000 }));
    const r = occupancyReport(full, 3, D(1), D(3), D(10));
    expect(r.occupancy).toBeCloseTo(1);
    expect(r.days.every((d) => d.occupancy <= 1.000001)).toBe(true);
  });
});
