import { describe, expect, it } from "vitest";
import { TRIAL_DAYS, activityOf, buildAlerts, buildOverview, parseStats, tenantsCsv, trialInfo, type Stats, type TenantRow } from "@/lib/platform";

const NOW = new Date("2026-11-17T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000);
const tenant = (id: string, over: Partial<TenantRow> = {}): TenantRow => ({ id, name: id, status: "trial", planId: "trial", createdAt: daysAgo(1), ...over });
const stats = (over: Partial<Stats> = {}): Stats => ({
  rooms: 3, members: 1, staysActive: 0, stays30d: 0, staysTotal: 0, reservationsOpen: 0, guests: 0, city: "Salvador", state: "BA",
  reportedAt: daysAgo(0), lastActiveAt: daysAgo(0), ...over,
});

describe("Fase 9 – painel da plataforma", () => {
  it("período de teste: dias restantes e vencimento", () => {
    expect(trialInfo(tenant("a", { createdAt: daysAgo(1) }), NOW)).toEqual({ daysLeft: TRIAL_DAYS - 1, expired: false });
    expect(trialInfo(tenant("a", { createdAt: daysAgo(TRIAL_DAYS + 2) }), NOW)?.expired).toBe(true);
    expect(trialInfo(tenant("a", { status: "active" }), NOW)).toBeNull();
  });

  it("classifica o uso pela última atividade", () => {
    expect(activityOf(undefined, NOW)).toBe("never");
    expect(activityOf(stats({ lastActiveAt: daysAgo(0.2) }), NOW)).toBe("today");
    expect(activityOf(stats({ lastActiveAt: daysAgo(3) }), NOW)).toBe("week");
    expect(activityOf(stats({ lastActiveAt: daysAgo(10) }), NOW)).toBe("idle");
    expect(activityOf(stats({ lastActiveAt: daysAgo(20) }), NOW)).toBe("dormant");
  });

  it("ignora valores inválidos nas contagens", () => {
    const s = parseStats({ rooms: -4, members: "x", staysTotal: 7, city: "Ilhéus" });
    expect(s.rooms).toBe(0);
    expect(s.members).toBe(0);
    expect(s.staysTotal).toBe(7);
    expect(s.city).toBe("Ilhéus");
  });

  it("visão geral: totais, ativos, parados e funil", () => {
    const tenants = [
      tenant("a", { status: "active", createdAt: daysAgo(40) }),
      tenant("b", { createdAt: daysAgo(2) }),
      tenant("c", { status: "cancelled", createdAt: daysAgo(100) }),
      tenant("d", { status: "suspended", createdAt: daysAgo(60) }),
    ];
    const st = {
      a: stats({ rooms: 8, members: 3, staysTotal: 50, stays30d: 12, reservationsOpen: 2 }),
      b: stats({ rooms: 0, lastActiveAt: daysAgo(0) }),
      d: stats({ lastActiveAt: daysAgo(30) }),
    };
    const o = buildOverview(tenants, st, NOW);
    expect(o.total).toBe(4);
    expect(o.byStatus).toMatchObject({ trial: 1, active: 1, suspended: 1, cancelled: 1 });
    expect(o.new7).toBe(1);
    expect(o.new30).toBe(1);
    expect(o.active7).toBe(2);
    expect(o.dormant).toBe(1);
    expect(o.totalRooms).toBe(11);
    expect(o.totalStays30d).toBe(12);
    expect(o.funnel.map((f) => f.value)).toEqual([3, 2, 1, 1, 1]); // canceladas ficam fora do funil
    expect(o.signups).toHaveLength(6);
    expect(o.signups[5].value).toBe(1); // novembro
  });

  it("alertas: teste vencido, perto de vencer, acima do limite, sem uso e parada", () => {
    const tenants = [
      tenant("vencido", { createdAt: daysAgo(TRIAL_DAYS + 3) }),
      tenant("quase", { createdAt: daysAgo(TRIAL_DAYS - 2) }),
      tenant("limite", { status: "active", maxRooms: 5 }),
      tenant("nunca", { status: "active", createdAt: daysAgo(10) }),
      tenant("parada", { status: "active", createdAt: daysAgo(90) }),
      tenant("cancelada", { status: "cancelled", createdAt: daysAgo(90) }),
    ];
    const st = {
      vencido: stats(), quase: stats(), limite: stats({ rooms: 9 }),
      parada: stats({ lastActiveAt: daysAgo(30) }), cancelada: stats({ lastActiveAt: daysAgo(30) }),
    };
    const alerts = buildAlerts(tenants, st, NOW);
    const of = (id: string) => alerts.filter((a) => a.tenantId === id).map((a) => a.level);
    expect(of("vencido")).toEqual(["alta"]);
    expect(of("quase")).toEqual(["media"]);
    expect(of("limite")).toEqual(["media"]);
    expect(of("nunca")).toEqual(["media"]);
    expect(of("parada")).toEqual(["info"]);
    expect(of("cancelada")).toEqual([]);
    expect(alerts[0].level).toBe("alta"); // mais graves primeiro
  });

  it("CSV tem só cadastro e contagens e protege contra fórmulas", () => {
    const csv = tenantsCsv([tenant("x", { displayName: '=HYPERLINK("http://x")' })], { x: stats() }, NOW);
    const [head, row] = csv.split("\n");
    expect(head).toContain("pousada");
    expect(head).not.toMatch(/hospede|documento|email|telefone|valor|receita/i);
    expect(row.startsWith(`"'=HYPERLINK`)).toBe(true);
  });
});
