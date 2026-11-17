import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase/firestore";
import { conflictMessage, findConflicts, overlaps, parseSchedule, stayBusy } from "../../src/lib/schedule";
import { parseReservation } from "../../src/lib/reservations";
import { reservationMessage } from "../../src/lib/whatsapp";

const D = (day: number, h = 12) => new Date(2026, 11, day, h);

describe("agenda dos quartos", () => {
  it("intervalos que só se encostam não conflitam (sai 12h, entra 12h)", () => {
    expect(overlaps(D(1), D(3), D(3), D(5))).toBe(false);
    expect(overlaps(D(1), D(3), D(2), D(5))).toBe(true);
    expect(overlaps(D(2), D(4), D(1), D(10))).toBe(true);
    expect(overlaps(D(1), D(2), D(5), D(6))).toBe(false);
  });

  it("acha a reserva que colide e ignora a própria reserva ao alterar", () => {
    const sched = { r1: { start: D(5), end: D(8), guestName: "Ana" }, r2: { start: D(10), end: D(12), guestName: "Bia" } };
    expect(findConflicts(sched, D(1), D(5))).toHaveLength(0);
    expect(findConflicts(sched, D(7), D(11)).map((c) => c.id)).toEqual(["r1", "r2"]);
    expect(findConflicts(sched, D(6), D(7), { ignore: "r1" })).toHaveLength(0);
  });

  it("hospedagem ativa ocupa até a saída prevista, ou até agora se passou do horário", () => {
    const st = { id: "s1", guestName: "Caio", checkInAt: D(1), plannedCheckOutAt: D(3) };
    expect(stayBusy(st, D(2)).end).toEqual(D(3));
    expect(stayBusy(st, D(4)).end).toEqual(D(4));
    expect(findConflicts({}, D(3), D(5), { activeStay: st, now: D(2) })).toHaveLength(0);
    const late = findConflicts({}, D(3), D(5), { activeStay: st, now: D(4) });
    expect(late).toHaveLength(1);
    expect(late[0].kind).toBe("stay");
  });

  it("mensagem de conflito diz quem ocupa e quando", () => {
    const c = findConflicts({ r1: { start: D(5), end: D(8), guestName: "Ana" } }, D(6), D(7));
    const m = conflictMessage(c, (d) => `${d.getDate()}/${d.getMonth() + 1}`);
    expect(m).toBe("Quarto indisponível: reservado para Ana de 5/12 a 8/12.");
    expect(conflictMessage([], String)).toBe("");
  });

  it("lê a agenda do banco e descarta itens incompletos", () => {
    const s = parseSchedule({ items: { a: { start: Timestamp.fromDate(D(1)), end: Timestamp.fromDate(D(2)), guestName: "X" }, b: { start: null } } });
    expect(Object.keys(s)).toEqual(["a"]);
    expect(s.a.end).toEqual(D(2));
    expect(parseSchedule(undefined)).toEqual({});
  });
});

describe("reserva", () => {
  it("lê o documento com valores padrão seguros", () => {
    const r = parseReservation("x", { status: "estranho", guestName: "Ana", checkInAt: Timestamp.fromDate(D(1)), plannedCheckOutAt: Timestamp.fromDate(D(3)), nights: 2 });
    expect(r.status).toBe("confirmed");
    expect(r.adults).toBe(1);
    expect(r.children).toBe(0);
    expect(r.guestId).toBeNull();
    expect(r.nights).toBe(2);
  });
  it("mensagem de confirmação tem quarto, diárias e valor", () => {
    const m = reservationMessage({ guestName: "Ana Souza", roomNumber: "4", checkInAt: D(20, 14), plannedCheckOutAt: D(22, 14), nights: 2, totalCents: 40000, pousada: "Pousada Sol" });
    expect(m.startsWith("Olá, Ana! Sua reserva está confirmada.")).toBe(true);
    expect(m).toContain("Quarto 4");
    expect(m).toContain("2 diárias");
    expect(m.replace(/\s/g, " ")).toContain("R$ 400,00");
    expect(m).toContain("— Pousada Sol");
  });
});
