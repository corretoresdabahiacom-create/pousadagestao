import { Timestamp, collection, doc, getDoc, getDocs } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";

const COLLECTIONS = [
  "roomCategories", "rooms", "guests", "stays", "stayNotes", "cashRegisters", "cashEntries", "revenues",
  "recurringExpenses", "accountsPayable", "accountsReceivable", "financialCategories", "suppliers",
  "cleaningTasks", "maintenanceTickets", "members", "auditLogs",
];
const STAY_SUBS = ["companions", "charges", "payments"];

function plain(v: unknown): unknown {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, plain(x)]));
  return v;
}

/**
 * Cópia completa dos dados da pousada em JSON (para guardar fora do Firebase).
 * Não inclui tokens/hashes de QR nem mensagens de chat. Coleções sem permissão são listadas em `skipped`.
 */
export async function buildBackup(t: string): Promise<{ json: string; counts: Record<string, number>; skipped: string[] }> {
  const { db } = getFirebase();
  const data: Record<string, unknown> = {};
  const counts: Record<string, number> = {};
  const skipped: string[] = [];

  try {
    const s = await getDoc(doc(db, `tenants/${t}`));
    data.tenant = s.exists() ? plain(s.data()) : null;
    const st = await getDoc(doc(db, `tenants/${t}/settings/main`));
    data.settings = st.exists() ? plain(st.data()) : null;
  } catch { skipped.push("tenant/settings"); }

  for (const name of COLLECTIONS) {
    try {
      const snap = await getDocs(collection(db, `tenants/${t}/${name}`));
      const rows: Record<string, unknown>[] = [];
      for (const d of snap.docs) {
        const row: Record<string, unknown> = { id: d.id, ...(plain(d.data()) as object) };
        if (name === "stays") {
          // Os campos do QR (hash de acesso) não vão para o backup.
          delete row.accessHash;
          for (const sub of STAY_SUBS) {
            try {
              const ss = await getDocs(collection(db, `tenants/${t}/stays/${d.id}/${sub}`));
              row[sub] = ss.docs.map((x) => ({ id: x.id, ...(plain(x.data()) as object) }));
            } catch { skipped.push(`stays/${d.id}/${sub}`); }
          }
        }
        rows.push(row);
      }
      data[name] = rows;
      counts[name] = rows.length;
    } catch { skipped.push(name); }
  }
  const json = JSON.stringify({ app: "PousadaGestor", tenantId: t, exportedAt: new Date().toISOString(), format: 1, data }, null, 1);
  return { json, counts, skipped };
}
