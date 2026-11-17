"use client";

import { useEffect, useState } from "react";
import { Timestamp, collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import { parseReservation, type Reservation } from "@/lib/reservations";
import { parseSchedule, type Schedule } from "@/lib/schedule";

/** Reservas com chegada a partir de `daysBack` dias atrás (todas as situações), em ordem de chegada. */
export function useReservations(tenantId: string | undefined, daysBack = 60) {
  const [list, setList] = useState<Reservation[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!tenantId) return;
    const { db } = getFirebase();
    const since = Timestamp.fromMillis(Date.now() - daysBack * 86400000);
    return onSnapshot(
      query(collection(db, `tenants/${tenantId}/reservations`), where("checkInAt", ">=", since), orderBy("checkInAt")),
      (s) => setList(s.docs.map((d) => parseReservation(d.id, d.data()))),
      () => setError("Não foi possível carregar as reservas."),
    );
  }, [tenantId, daysBack]);
  return { reservations: list, error };
}

/** Agenda de todos os quartos (roomId → reservas confirmadas). */
export function useRoomSchedules(tenantId: string | undefined) {
  const [map, setMap] = useState<Record<string, Schedule> | null>(null);
  useEffect(() => {
    if (!tenantId) return;
    const { db } = getFirebase();
    return onSnapshot(
      collection(db, `tenants/${tenantId}/roomSchedules`),
      (s) => setMap(Object.fromEntries(s.docs.map((d) => [d.id, parseSchedule(d.data())]))),
      () => setMap({}),
    );
  }, [tenantId]);
  return map;
}
