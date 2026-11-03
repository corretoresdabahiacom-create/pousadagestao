"use client";

import { useEffect } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";

export const DEFAULT_BRAND = "#0f766e";
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export const BRAND_PRESETS = [
  { name: "Verde-azulado", hex: "#0f766e" },
  { name: "Azul", hex: "#1d4ed8" },
  { name: "Verde", hex: "#15803d" },
  { name: "Laranja", hex: "#c2410c" },
  { name: "Vinho", hex: "#9f1239" },
  { name: "Roxo", hex: "#6d28d9" },
  { name: "Grafite", hex: "#334155" },
];

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste do texto branco sobre a cor (mínimo recomendado para leitura: 4,5). */
export function contrastWithWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

export function applyBrand(hex: string | undefined | null) {
  if (typeof document === "undefined") return;
  const ok = hex && HEX_RE.test(hex) && contrastWithWhite(hex) >= 4.5;
  document.documentElement.style.setProperty("--brand", ok ? (hex as string) : DEFAULT_BRAND);
}

/** Aplica a cor da pousada (publicInfo/main.brandColor) em todo o painel. */
export function useBrandTheme(tenantId: string | undefined) {
  useEffect(() => {
    if (!tenantId) return;
    const { db } = getFirebase();
    const unsub = onSnapshot(
      doc(db, `tenants/${tenantId}/publicInfo/main`),
      (snap) => applyBrand(snap.data()?.brandColor as string | undefined),
      () => applyBrand(null),
    );
    return () => {
      unsub();
      applyBrand(null);
    };
  }, [tenantId]);
}
