import { Timestamp, type QueryConstraint, collection, doc, getCountFromServer, getDoc, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import { isManager, type Role } from "@/lib/types";

const COUNTS_EVERY_MS = 6 * 3600_000; // contagens: no máximo a cada 6 h por aparelho
const ACTIVITY_EVERY_MS = 30 * 60_000; // "última atividade": no máximo a cada 30 min

function due(key: string, every: number): boolean {
  try {
    const last = Number(localStorage.getItem(key) ?? 0);
    if (Date.now() - last < every) return false;
    localStorage.setItem(key, String(Date.now()));
  } catch {
    /* sem armazenamento: apenas segue (não há como limitar a frequência) */
  }
  return true;
}

/**
 * Envia ao dono da plataforma o uso agregado desta pousada: somente CONTAGENS, cidade/UF e a data
 * da última atividade. Nunca envia nome, documento, contato, valores ou conteúdo de hóspedes.
 * É telemetria de melhor esforço: qualquer erro é ignorado e não atrapalha o uso do sistema.
 */
export async function reportUsage(tenantId: string, role: Role): Promise<void> {
  const { db } = getFirebase();
  const statsRef = doc(db, `tenantStats/${tenantId}`);
  try {
    if (isManager(role) && due(`usage:counts:${tenantId}`, COUNTS_EVERY_MS)) {
      const base = `tenants/${tenantId}`;
      const n = async (path: string, ...c: QueryConstraint[]) =>
        (await getCountFromServer(query(collection(db, `${base}/${path}`), ...c))).data().count;
      const since = Timestamp.fromMillis(Date.now() - 30 * 86400000);
      const [rooms, archived, members, staysActive, stays30d, staysTotal, reservationsOpen, guests, pub] = await Promise.all([
        n("rooms"), n("rooms", where("archived", "==", true)), n("members", where("active", "==", true)),
        n("stays", where("status", "==", "active")), n("stays", where("checkInAt", ">=", since)), n("stays"),
        n("reservations", where("status", "==", "confirmed")), n("guests"), getDoc(doc(db, `${base}/publicInfo/main`)),
      ]);
      await setDoc(statsRef, {
        rooms: Math.max(0, rooms - archived), members, staysActive, stays30d, staysTotal, reservationsOpen, guests,
        city: String(pub.data()?.city ?? "").slice(0, 60), state: String(pub.data()?.state ?? "").slice(0, 2),
        reportedAt: serverTimestamp(), lastActiveAt: serverTimestamp(),
      });
      localStorage.setItem(`usage:activity:${tenantId}`, String(Date.now()));
      return;
    }
    if (due(`usage:activity:${tenantId}`, ACTIVITY_EVERY_MS)) await updateDoc(statsRef, { lastActiveAt: serverTimestamp() });
  } catch {
    /* telemetria opcional */
  }
}
