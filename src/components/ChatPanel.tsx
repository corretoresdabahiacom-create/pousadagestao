"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { addDoc, collection, doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import { friendlyError } from "@/lib/auth/AuthProvider";
import { useMessages } from "@/lib/useStays";
import { Alert, Button, Input, Spinner } from "@/components/ui";

/** Conversa de uma hospedagem. `as` define de que lado quem usa o painel está. */
export function ChatPanel({
  tenantId,
  stayId,
  as,
  uid,
  disabled,
}: {
  tenantId: string;
  stayId: string;
  as: "staff" | "guest";
  uid: string;
  disabled?: boolean;
}) {
  const { messages, denied } = useMessages(tenantId, stayId);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages?.length]);

  // Marca como lidas as mensagens do outro lado.
  useEffect(() => {
    if (!messages || disabled) return;
    const other = as === "staff" ? "guest" : "staff";
    const field = as === "staff" ? "readByStaffAt" : "readByGuestAt";
    const unread = messages.filter((m) => m.sender === other && !(as === "staff" ? m.readByStaffAt : m.readByGuestAt));
    if (!unread.length) return;
    const { db } = getFirebase();
    const b = writeBatch(db);
    unread.slice(0, 20).forEach((m) => b.update(doc(db, `tenants/${tenantId}/stays/${stayId}/messages/${m.id}`), { [field]: serverTimestamp() }));
    b.commit().catch(() => undefined);
  }, [messages, as, tenantId, stayId, disabled]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    setBusy(true);
    setError("");
    try {
      const { db } = getFirebase();
      await addDoc(collection(db, `tenants/${tenantId}/stays/${stayId}/messages`), {
        sender: as,
        ...(as === "staff" ? { senderUid: uid } : {}),
        text: v.slice(0, 2000),
        createdAt: serverTimestamp(),
      });
      setText("");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  if (denied) return <Alert>O chat não está disponível.</Alert>;
  if (!messages) return <Spinner />;

  return (
    <div className="flex h-96 flex-col rounded-xl border border-slate-200 bg-white">
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 && <p className="p-4 text-center text-sm text-slate-500">Nenhuma mensagem ainda.</p>}
        {messages.map((m) => {
          const mine = m.sender === as;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-900"}`}>
                <p className="mb-0.5 text-[11px] font-medium opacity-80">{m.sender === "staff" ? "Recepção" : "Hóspede"}</p>
                {/* Texto puro: React escapa o conteúdo, sem HTML. */}
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
                <p className="mt-0.5 text-right text-[10px] opacity-70">
                  {m.createdAt?.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      {error && <div className="px-3"><Alert>{error}</Alert></div>}
      <form onSubmit={send} className="flex gap-2 border-t border-slate-200 p-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Escreva uma mensagem…" disabled={disabled} aria-label="Mensagem" />
        <Button type="submit" loading={busy} disabled={disabled || !text.trim()}>Enviar</Button>
      </form>
    </div>
  );
}
