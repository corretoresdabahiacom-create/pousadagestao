/** Token do QR Code: 256 bits aleatórios (crypto), em base64url. Só o hash SHA-256 vai ao banco. */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 em hexadecimal (64 caracteres), igual ao que as Rules exigem no ID de stayAccess. */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Link do portal. O token fica no fragmento (#), que o navegador não envia ao servidor
 * nem em cabeçalhos Referer; o identificador da pousada não é segredo.
 */
export function portalUrl(tenantId: string, token: string): string {
  return `${window.location.origin}/h/?t=${encodeURIComponent(tenantId)}#${token}`;
}
