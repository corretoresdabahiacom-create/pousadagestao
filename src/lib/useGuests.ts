"use client";

import { useCallback, useEffect, useState } from "react";
import { collection, getDocs, limit, query } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import type { GuestData } from "@/lib/stays";

export interface GuestRecord extends GuestData {
  id: string;
}

export const emptyGuest: GuestData = {
  fullName: "",
  phone: "",
  whatsapp: "",
  email: "",
  document: "",
  birthDate: "",
  emergencyName: "",
  emergencyPhone: "",
  emergencyRelation: "",
  notes: "",
};

/** Carrega o cadastro de hóspedes uma vez (recarrega sob demanda). Só recepção/gestão têm acesso. */
export function useGuests(tenantId: string | undefined) {
  const [guests, setGuests] = useState<GuestRecord[] | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!tenantId) return;
    let alive = true;
    const { db } = getFirebase();
    getDocs(query(collection(db, `tenants/${tenantId}/guests`), limit(1000)))
      .then((snap) => {
        if (!alive) return;
        const list = snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            fullName: (x.fullName as string) ?? "",
            phone: (x.phone as string) ?? "",
            whatsapp: (x.whatsapp as string) ?? "",
            email: (x.email as string) ?? "",
            document: (x.document as string) ?? "",
            birthDate: (x.birthDate as string) ?? "",
            emergencyName: (x.emergency?.name as string) ?? "",
            emergencyPhone: (x.emergency?.phone as string) ?? "",
            emergencyRelation: (x.emergency?.relation as string) ?? "",
            notes: (x.notes as string) ?? "",
          } satisfies GuestRecord;
        });
        list.sort((a, b) => a.fullName.localeCompare(b.fullName, "pt-BR"));
        setGuests(list);
      })
      .catch(() => alive && setError("Não foi possível carregar os hóspedes."));
    return () => {
      alive = false;
    };
  }, [tenantId, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { guests, error, reload };
}

export function matchGuest(g: GuestRecord, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const digits = s.replace(/\D/g, "");
  return (
    g.fullName.toLowerCase().includes(s) ||
    g.email.includes(s) ||
    (digits.length >= 3 && (g.phone.replace(/\D/g, "").includes(digits) || g.whatsapp.replace(/\D/g, "").includes(digits) || g.document.replace(/\D/g, "").includes(digits)))
  );
}
