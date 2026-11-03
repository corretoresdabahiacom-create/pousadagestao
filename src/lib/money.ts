// Dinheiro sempre em centavos (inteiros). Nunca usar ponto flutuante em cálculos financeiros.

/** Converte texto digitado ("1.250,50", "150,5", "150") em centavos. Retorna null se inválido. */
export function parseBRLToCents(input: string): number | null {
  const s = input.replace(/[^\d.,]/g, "").trim();
  if (!s) return null;

  let intPart = s;
  let frac = "";
  const comma = s.lastIndexOf(",");

  if (comma >= 0) {
    intPart = s.slice(0, comma);
    frac = s.slice(comma + 1);
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    // "150.50" sem vírgula: ponto como separador decimal
    const dot = s.lastIndexOf(".");
    intPart = s.slice(0, dot);
    frac = s.slice(dot + 1);
  }

  intPart = intPart.replace(/\./g, "");
  if (!/^\d*$/.test(intPart) || !/^\d{0,2}$/.test(frac)) return null;
  if (intPart === "" && frac === "") return null;

  const cents = Number(intPart || "0") * 100 + Number((frac + "00").slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Texto para preencher um campo de edição a partir de centavos. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
