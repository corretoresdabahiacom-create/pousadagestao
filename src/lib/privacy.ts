import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import { audit } from "@/lib/audit";

/**
 * Direito de eliminação (LGPD, art. 18, VI): apaga os dados pessoais do CADASTRO do hóspede.
 * O registro continua existindo (as hospedagens apontam para ele), mas sem nome, documento,
 * contato, nascimento, contato de emergência ou observações. A operação não tem volta.
 * As hospedagens já encerradas mantêm o nome usado na época, porque são registros de contrato e
 * fiscais que a pousada precisa guardar (art. 16, I); veja docs/LGPD.md.
 */
export async function anonymizeGuest(tenantId: string, uid: string, guestId: string): Promise<void> {
  const { db } = getFirebase();
  await setDoc(
    doc(db, `tenants/${tenantId}/guests/${guestId}`),
    {
      fullName: "Hóspede anonimizado",
      nameLower: "hóspede anonimizado",
      phone: "", whatsapp: "", email: "", document: "", birthDate: "",
      emergency: { name: "", phone: "", relation: "" },
      notes: "",
      anonymizedAt: serverTimestamp(),
      anonymizedBy: uid,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  await audit(tenantId, uid, "guest.anonymize", { guestId });
}
