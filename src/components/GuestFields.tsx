"use client";

import type { GuestData } from "@/lib/stays";
import { Field, Input, Textarea } from "@/components/ui";

/** Campos do responsável. Só pede o necessário; documento e nascimento são opcionais. */
export function GuestFields({ value, onChange }: { value: GuestData; onChange: (v: GuestData) => void }) {
  const set = (k: keyof GuestData) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Nome completo *">
          <Input value={value.fullName} onChange={set("fullName")} required maxLength={120} autoComplete="off" />
        </Field>
      </div>
      <Field label="Telefone">
        <Input type="tel" value={value.phone} onChange={set("phone")} maxLength={20} />
      </Field>
      <Field label="WhatsApp">
        <Input type="tel" value={value.whatsapp} onChange={set("whatsapp")} maxLength={20} />
      </Field>
      <Field label="E-mail (opcional)">
        <Input type="email" value={value.email} onChange={set("email")} maxLength={120} />
      </Field>
      <Field label="Documento (opcional)" hint="Peça só quando necessário. Guardamos apenas o número, nunca a foto do documento.">
        <Input value={value.document} onChange={set("document")} maxLength={30} autoComplete="off" />
      </Field>
      <Field label="Data de nascimento (opcional)">
        <Input type="date" value={value.birthDate} onChange={set("birthDate")} />
      </Field>
      <div className="sm:col-span-2 grid gap-4 sm:grid-cols-3">
        <Field label="Contato de emergência">
          <Input value={value.emergencyName} onChange={set("emergencyName")} maxLength={120} />
        </Field>
        <Field label="Telefone do contato">
          <Input type="tel" value={value.emergencyPhone} onChange={set("emergencyPhone")} maxLength={20} />
        </Field>
        <Field label="Parentesco">
          <Input value={value.emergencyRelation} onChange={set("emergencyRelation")} maxLength={40} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Observações">
          <Textarea rows={2} value={value.notes} onChange={set("notes")} maxLength={500} />
        </Field>
      </div>
    </div>
  );
}
