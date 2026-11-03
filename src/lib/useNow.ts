"use client";
import { useEffect, useState } from "react";

/** Hora atual que se atualiza sozinha (evita chamar Date.now() durante a renderização). */
export function useNow(everyMs = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
