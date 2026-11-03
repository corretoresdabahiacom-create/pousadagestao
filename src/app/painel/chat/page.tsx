"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useActiveStays, useMessages } from "@/lib/useStays";
import { ChatPanel } from "@/components/ChatPanel";
import { Alert, Badge, Card, EmptyState, Spinner } from "@/components/ui";

function Unread({ tenantId, stayId }: { tenantId: string; stayId: string }) {
  const { messages } = useMessages(tenantId, stayId);
  const n = (messages ?? []).filter((m) => m.sender === "guest" && !m.readByStaffAt).length;
  return n > 0 ? <Badge className="bg-red-50 text-red-700 ring-red-600/20">{n} nova{n > 1 ? "s" : ""}</Badge> : null;
}

export default function ChatPage() {
  const { user, membership } = useAuth();
  const tenantId = membership?.tenantId;
  const allowed = ["owner", "admin", "reception"].includes(membership?.role ?? "");
  const { stays, error } = useActiveStays(allowed ? tenantId : undefined);
  const [sel, setSel] = useState<string | null>(null);

  if (!allowed) return <Alert>Seu perfil não tem acesso ao chat.</Alert>;
  if (error) return <Alert>{error}</Alert>;
  if (!stays || !tenantId || !user) return <Spinner />;
  const current = stays.find((s) => s.id === sel) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Chat com hóspedes</h1>
        <p className="text-sm text-slate-600">Conversas das hospedagens ativas. Quando a hospedagem é encerrada, a conversa fica só para consulta no histórico.</p>
      </div>
      {stays.length === 0 ? (
        <EmptyState title="Nenhum hóspede hospedado" text="As conversas aparecem aqui quando houver hospedagens ativas." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <Card className="!p-0">
            <ul className="divide-y divide-slate-100">
              {stays.map((s) => (
                <li key={s.id}>
                  <button onClick={() => setSel(s.id)} className={`flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm hover:bg-slate-50 ${sel === s.id ? "bg-brand-50" : ""}`}>
                    <span className="min-w-0"><span className="block truncate font-medium">Quarto {s.roomNumber}</span><span className="block truncate text-slate-500">{s.guestName}</span></span>
                    <Unread tenantId={tenantId} stayId={s.id} />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <div>
            {current ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">Quarto {current.roomNumber} · {current.guestName} · <Link className="text-brand-700 hover:underline" href={`/painel/hospedagem/?id=${current.id}`}>ver hospedagem</Link></p>
                <ChatPanel key={current.id} tenantId={tenantId} stayId={current.id} as="staff" uid={user.uid} />
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Escolha uma conversa.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
