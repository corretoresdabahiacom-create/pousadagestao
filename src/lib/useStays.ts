"use client";

import { useEffect, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import { parseCharge, parsePayment, parseStay, type Charge, type Companion, type Payment, type Stay } from "@/lib/stays";

/** Hospedagens ativas em tempo real. */
export function useActiveStays(tenantId: string | undefined) {
  const [stays, setStays] = useState<Stay[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!tenantId) return;
    const { db } = getFirebase();
    return onSnapshot(
      query(collection(db, `tenants/${tenantId}/stays`), where("status", "==", "active")),
      (s) => {
        const list = s.docs.map((d) => parseStay(d.id, d.data()));
        list.sort((a, b) => a.plannedCheckOutAt.getTime() - b.plannedCheckOutAt.getTime());
        setStays(list);
      },
      () => setError("Não foi possível carregar as hospedagens."),
    );
  }, [tenantId]);
  return { stays, error };
}

/** Hospedagens encerradas mais recentes. */
export function useClosedStays(tenantId: string | undefined, max = 100) {
  const [stays, setStays] = useState<Stay[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!tenantId) return;
    const { db } = getFirebase();
    return onSnapshot(
      query(collection(db, `tenants/${tenantId}/stays`), where("status", "==", "closed"), limit(max)),
      (s) => {
        const list = s.docs.map((d) => parseStay(d.id, d.data()));
        list.sort((a, b) => (b.checkedOutAt?.getTime() ?? 0) - (a.checkedOutAt?.getTime() ?? 0));
        setStays(list);
      },
      () => setError("Não foi possível carregar o histórico."),
    );
  }, [tenantId, max]);
  return { stays, error };
}

/** Uma hospedagem com lançamentos, pagamentos e acompanhantes. */
export function useStay(tenantId: string | undefined, stayId: string | null) {
  const [stay, setStay] = useState<Stay | null | undefined>(undefined);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!tenantId || !stayId) return;
    const { db } = getFirebase();
    const base = `tenants/${tenantId}/stays/${stayId}`;
    const fail = () => setError("Não foi possível carregar a hospedagem.");
    const u = [
      onSnapshot(doc(db, base), (s) => setStay(s.exists() ? parseStay(s.id, s.data()) : null), fail),
      onSnapshot(
        collection(db, `${base}/charges`),
        (s) => setCharges(s.docs.map((d) => parseCharge(d.id, d.data())).sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))),
        fail,
      ),
      onSnapshot(
        collection(db, `${base}/payments`),
        (s) => setPayments(s.docs.map((d) => parsePayment(d.id, d.data())).sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))),
        fail,
      ),
      onSnapshot(
        collection(db, `${base}/companions`),
        (s) => setCompanions(s.docs.map((d) => ({ id: d.id, fullName: d.data().fullName as string, document: d.data().document as string, birthDate: d.data().birthDate as string }))),
        fail,
      ),
    ];
    return () => u.forEach((f) => f());
  }, [tenantId, stayId]);

  return { stay, charges, payments, companions, error };
}

export interface ChatMessage {
  id: string;
  sender: "guest" | "staff";
  text: string;
  createdAt: Date | null;
  readByStaffAt: Date | null;
  readByGuestAt: Date | null;
}

/** Mensagens do chat de uma hospedagem (ordem cronológica). */
export function useMessages(tenantId: string | undefined, stayId: string | null | undefined) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    if (!tenantId || !stayId) return;
    const { db } = getFirebase();
    return onSnapshot(
      query(collection(db, `tenants/${tenantId}/stays/${stayId}/messages`), orderBy("createdAt", "asc"), limit(300)),
      (s) => {
        setDenied(false);
        setMessages(
          s.docs.map((d) => {
            const x = d.data({ serverTimestamps: "estimate" });
            return {
              id: d.id,
              sender: x.sender === "staff" ? "staff" : "guest",
              text: String(x.text ?? ""),
              createdAt: x.createdAt?.toDate?.() ?? null,
              readByStaffAt: x.readByStaffAt?.toDate?.() ?? null,
              readByGuestAt: x.readByGuestAt?.toDate?.() ?? null,
            } satisfies ChatMessage;
          }),
        );
      },
      () => setDenied(true),
    );
  }, [tenantId, stayId]);
  return { messages, denied };
}
