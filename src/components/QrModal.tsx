"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { portalUrl } from "@/lib/tokens";
import { Alert, Button, Modal } from "@/components/ui";

/**
 * Mostra o QR Code uma única vez: o banco guarda só o hash, então o token não é recuperável.
 * Para um novo QR Code, use "Reemitir" na hospedagem (o anterior é revogado).
 */
export function QrModal({
  tenantId,
  token,
  title,
  subtitle,
  onClose,
}: {
  tenantId: string;
  token: string;
  title: string;
  subtitle: string;
  onClose: () => void;
}) {
  const [img, setImg] = useState("");
  const [msg, setMsg] = useState("");
  const url = portalUrl(tenantId, token);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, { width: 360, margin: 2, errorCorrectionLevel: "M" }).then((d) => alive && setImg(d));
    return () => {
      alive = false;
    };
  }, [url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setMsg("Link copiado.");
    } catch {
      setMsg("Não foi possível copiar. Selecione o link e copie.");
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4 text-center">
        <Alert kind="info">
          Mostre este QR Code ao hóspede agora. Por segurança ele <strong>não fica salvo</strong> no sistema; se precisar de outro,
          use “Reemitir QR Code” (o anterior deixa de valer).
        </Alert>
        <p className="font-medium">{subtitle}</p>
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="QR Code do portal do hóspede" className="mx-auto h-72 w-72 rounded-lg border border-slate-200" />
        ) : (
          <div className="mx-auto h-72 w-72 animate-pulse rounded-lg bg-slate-100" />
        )}
        <p className="break-all rounded bg-slate-50 p-2 text-left text-xs text-slate-600">{url}</p>
        {msg && <p className="text-sm text-emerald-700">{msg}</p>}
        <div className="flex flex-wrap justify-center gap-2 print:hidden">
          <Button variant="secondary" onClick={copy}>Copiar link</Button>
          <Button variant="secondary" onClick={() => window.print()}>Imprimir</Button>
          <Button onClick={onClose}>Concluir</Button>
        </div>
      </div>
    </Modal>
  );
}
