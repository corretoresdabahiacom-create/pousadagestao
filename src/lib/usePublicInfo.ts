"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";

/** Dados públicos da pousada (nome, contatos, endereço, textos), lidos uma vez. */
export interface PublicInfo {
  displayName?: string;
  phone?: string;
  whatsapp?: string;
  address?: string;
  city?: string;
  state?: string;
  logoDataUrl?: string;
  checkoutReminderText?: string;
}

export function usePublicInfo(tenantId: string | undefined): PublicInfo {
  const [info, setInfo] = useState<PublicInfo>({});
  useEffect(() => {
    if (!tenantId) return;
    const { db } = getFirebase();
    let alive = true;
    getDoc(doc(db, `tenants/${tenantId}/publicInfo/main`))
      .then((s) => { if (alive) setInfo((s.data() as PublicInfo) ?? {}); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [tenantId]);
  return info;
}
