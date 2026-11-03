export type Cell = string | number | Date | null;
export interface Table { title: string; headers: string[]; rows: Cell[][]; moneyCols?: number[] }

/** Evita "injeção de fórmula" em planilhas: texto que começa com = + - @ vira texto literal. */
const safeText = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
const fmtCell = (c: Cell, money: boolean): string => {
  if (c === null) return "";
  if (c instanceof Date) return c.toLocaleString("pt-BR");
  if (typeof c === "number") return money ? (c / 100).toFixed(2).replace(".", ",") : String(c);
  return safeText(c);
};

export function toCsv(t: Table): string {
  const money = new Set(t.moneyCols ?? []);
  const esc = (v: string) => (/[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [t.headers, ...t.rows.map((r) => r.map((c, i) => fmtCell(c, money.has(i))))].map((r) => r.map((v) => esc(String(v))).join(";"));
  return "﻿" + lines.join("\r\n"); // BOM para o Excel abrir com acentos
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const downloadCsv = (t: Table, name: string) => download(new Blob([toCsv(t)], { type: "text/csv;charset=utf-8" }), `${name}.csv`);

export async function downloadXlsx(t: Table, name: string) {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const money = new Set(t.moneyCols ?? []);
  const head = t.headers.map((h) => ({ value: h, fontWeight: "bold" as const }));
  const body = t.rows.map((r) =>
    r.map((c, i) => {
      if (c === null) return null;
      if (c instanceof Date) return { value: c, type: Date, format: "dd/mm/yyyy hh:mm" };
      if (typeof c === "number") return money.has(i) ? { value: c / 100, type: Number, format: "#,##0.00" } : { value: c, type: Number };
      return { value: safeText(c), type: String };
    }),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (writeExcelFile as any)([head, ...body], { columns: t.headers.map(() => ({ width: 22 })) }).toFile(`${name}.xlsx`);
}
