import { fmtDateTime } from "@/lib/format";

/**
 * Converte um telefone digitado em número no formato do WhatsApp (só dígitos, com DDI).
 * Números brasileiros com DDD (10 ou 11 dígitos) recebem o 55 na frente.
 * Devolve null quando não parece um telefone válido.
 */
export function waNumber(phone: string | undefined | null): string | null {
  if (!phone) return null;
  const raw = phone.trim();
  let d = raw.replace(/\D/g, "");
  const intl = (x: string) => (x.length >= 8 && x.length <= 15 ? x : null);
  if (raw.startsWith("+")) return intl(d); // já tem DDI
  if (d.startsWith("00")) return intl(d.slice(2)); // 00 + DDI
  if (d.startsWith("0") && (d.length === 11 || d.length === 12)) d = d.slice(1); // 0 + DDD + número
  if (d.length === 10 || d.length === 11) d = `55${d}`; // DDD + número (Brasil)
  if (d.length < 12 || d.length > 15) return null;
  return d;
}

/** Link que abre a conversa no WhatsApp (celular ou WhatsApp Web) com a mensagem já escrita. */
export function waLink(phone: string | undefined | null, text: string): string | null {
  const n = waNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}

export const DEFAULT_CHECKOUT_TEXT =
  "Lembramos que o horário de saída está chegando. Se quiser prorrogar a estadia, é só responder esta mensagem.";

/** Mensagem de aviso de saída: saudação com o primeiro nome, texto da pousada, quarto e horário. */
export function checkoutMessage(o: { guestName: string; roomNumber: string; checkOutAt: Date; pousada?: string; text?: string }): string {
  const first = o.guestName.trim().split(/\s+/)[0] || "";
  const hello = first ? `Olá, ${first}!` : "Olá!";
  const body = (o.text || DEFAULT_CHECKOUT_TEXT).trim();
  const when = `Saída prevista: ${fmtDateTime(o.checkOutAt)} (quarto ${o.roomNumber}).`;
  return [hello, body, when, o.pousada ? `— ${o.pousada}` : ""].filter(Boolean).join("\n");
}
