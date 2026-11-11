"use client";

import { useEffect } from "react";

/** Registra o service worker (app instalável). Falha em silêncio se o navegador não suportar. */
export function RegisterSW() {
  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator && location.pathname.indexOf("/h/") !== 0) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
