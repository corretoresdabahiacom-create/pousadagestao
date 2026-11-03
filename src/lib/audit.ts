import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";

/**
 * Registra uma operação sensível. As Rules exigem actorUid = usuário logado e
 * "at" = horário do servidor, e não permitem editar ou apagar registros.
 */
export async function audit(
  tenantId: string,
  actorUid: string,
  action: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const { db } = getFirebase();
  await addDoc(collection(db, `tenants/${tenantId}/auditLogs`), {
    actorUid,
    action,
    details,
    at: serverTimestamp(),
  });
}
