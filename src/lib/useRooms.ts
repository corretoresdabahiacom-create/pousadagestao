"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import type { Room, RoomStatus } from "@/lib/types";

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/** Quartos da pousada em tempo real, ordenados por número (1, 2, 10…). */
export function useRooms(tenantId: string | undefined) {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!tenantId) return;
    const { db } = getFirebase();
    return onSnapshot(
      collection(db, `tenants/${tenantId}/rooms`),
      (snap) => {
        const list = snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            number: String(x.number ?? ""),
            name: x.name as string | undefined,
            categoryId: (x.categoryId as string) ?? "outras",
            description: x.description as string | undefined,
            capacity: Number(x.capacity ?? 1),
            beds: Number(x.beds ?? 1),
            dailyRateCents: Number(x.dailyRateCents ?? 0),
            extraPersonCents: x.extraPersonCents as number | undefined,
            amenities: (x.amenities as string[]) ?? [],
            notes: x.notes as string | undefined,
            status: (x.status as RoomStatus) ?? "available",
            archived: x.archived === true,
          } satisfies Room;
        });
        list.sort((a, b) => collator.compare(a.number, b.number));
        setRooms(list);
        setError("");
      },
      () => setError("Não foi possível carregar os quartos."),
    );
  }, [tenantId]);

  return { rooms, error };
}
