/**
 * Reduz a imagem no navegador e devolve um data URL JPEG/PNG pequeno.
 * Sem Cloud Storage (plano gratuito), as fotos ficam no Firestore, então precisam ser leves.
 */
export async function compressImage(
  file: File,
  opts: { maxSide: number; maxChars: number; png?: boolean },
): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Escolha um arquivo de imagem (JPG, PNG ou WebP).");
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, opts.maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível processar a imagem neste navegador.");
  if (!opts.png) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();

  if (opts.png) {
    const url = canvas.toDataURL("image/png");
    if (url.length <= opts.maxChars) return url;
  }
  if (opts.png) {
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  for (const q of [0.82, 0.72, 0.62, 0.5, 0.4, 0.3]) {
    const url = canvas.toDataURL("image/jpeg", q);
    if (url.length <= opts.maxChars) return url;
  }
  throw new Error("A imagem é complexa demais. Tente uma foto menor.");
}
