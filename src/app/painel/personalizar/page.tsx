"use client";

import { useEffect, useRef, useState } from "react";
import { addDoc, collection, deleteDoc, deleteField, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import { audit } from "@/lib/audit";
import { friendlyError, useAuth } from "@/lib/auth/AuthProvider";
import { isManager } from "@/lib/types";
import { BRAND_PRESETS, DEFAULT_BRAND, HEX_RE, applyBrand, contrastWithWhite } from "@/lib/branding";
import { compressImage } from "@/lib/images";
import { PHOTO_CATEGORIES, usePhotos, type PhotoCategory } from "@/lib/usePhotos";
import { useRooms } from "@/lib/useRooms";
import { Alert, Button, Card, EmptyState, Field, Input, Select, Spinner, Textarea } from "@/components/ui";

const MAX_PHOTOS = 60;
const MAPS_HOSTS = ["google.com", "www.google.com", "maps.google.com", "maps.app.goo.gl", "goo.gl", "g.co"];

function validMapsUrl(v: string): boolean {
  if (!v) return true;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && MAPS_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

interface Info {
  brandColor?: string;
  logoDataUrl?: string;
  description?: string;
  mapsUrl?: string;
  checkoutReminderText?: string;
  paymentInfo?: string;
  address?: string;
  city?: string;
  state?: string;
}

export default function PersonalizarPage() {
  const { user, membership } = useAuth();
  const tenantId = membership?.tenantId;
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!tenantId) return;
    const { db } = getFirebase();
    return onSnapshot(
      doc(db, `tenants/${tenantId}/publicInfo/main`),
      (s) => setInfo((s.data() as Info | undefined) ?? {}),
      () => setError("Não foi possível carregar os dados da pousada."),
    );
  }, [tenantId]);

  if (!isManager(membership?.role)) return <Alert>Apenas o proprietário e os administradores personalizam a pousada.</Alert>;
  if (error) return <Alert>{error}</Alert>;
  if (!info || !tenantId || !user) return <Spinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Personalizar</h1>
        <p className="text-sm text-slate-600">Cor, logo, fotos e localização. Esses dados aparecem no portal do hóspede.</p>
      </div>
      {notice && <Alert kind="success">{notice}</Alert>}
      <Identity tenantId={tenantId} uid={user.uid} info={info} onNotice={setNotice} />
      <About tenantId={tenantId} uid={user.uid} info={info} onNotice={setNotice} />
      <Gallery tenantId={tenantId} uid={user.uid} onNotice={setNotice} />
    </div>
  );
}

function Identity({ tenantId, uid, info, onNotice }: { tenantId: string; uid: string; info: Info; onNotice: (m: string) => void }) {
  const saved = info.brandColor && HEX_RE.test(info.brandColor) ? info.brandColor : DEFAULT_BRAND;
  const [edited, setEdited] = useState<string | null>(null);
  const color = edited ?? saved;
  const setColor = (v: string) => setEdited(v);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const valid = HEX_RE.test(color);
  const contrast = valid ? contrastWithWhite(color) : 0;
  const readable = valid && contrast >= 4.5;

  // Pré-visualização ao vivo (volta ao salvo ao sair da página, pelo tema do painel).
  useEffect(() => {
    if (valid) applyBrand(readable ? color : saved);
    return () => applyBrand(saved);
  }, [color, valid, readable, saved]);

  async function patch(data: Record<string, unknown>, action: string, msg: string) {
    setErr("");
    setBusy(true);
    try {
      const { db } = getFirebase();
      await setDoc(doc(db, `tenants/${tenantId}/publicInfo/main`), { ...data, updatedAt: serverTimestamp() }, { merge: true });
      await audit(tenantId, uid, action, {});
      setEdited(null);
      onNotice(msg);
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function onLogo(file: File | undefined) {
    if (!file) return;
    setErr("");
    try {
      const url = await compressImage(file, { maxSide: 400, maxChars: 150000, png: true });
      await patch({ logoDataUrl: url }, "branding.logo", "Logo atualizado.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : friendlyError(e));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-base font-semibold">Identidade visual</h2>
      {err && <Alert>{err}</Alert>}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <Field label="Cor principal" hint="Usada em botões, links e destaques do sistema.">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={valid ? color : DEFAULT_BRAND}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded border border-slate-300 bg-white p-1"
                aria-label="Escolher cor"
              />
              <Input value={color} onChange={(e) => setColor(e.target.value)} maxLength={7} className="max-w-32 font-mono" />
            </div>
          </Field>
          <div className="flex flex-wrap gap-2">
            {BRAND_PRESETS.map((p) => (
              <button
                key={p.hex}
                type="button"
                title={p.name}
                aria-label={p.name}
                onClick={() => setColor(p.hex)}
                style={{ backgroundColor: p.hex }}
                className={`h-8 w-8 rounded-full ring-2 ring-offset-2 ${color.toLowerCase() === p.hex ? "ring-slate-900" : "ring-transparent"}`}
              />
            ))}
          </div>
          {!valid && <Alert>Use o formato #RRGGBB, por exemplo #0f766e.</Alert>}
          {valid && !readable && (
            <Alert>Essa cor é clara demais: o texto branco dos botões ficaria difícil de ler. Escolha uma cor mais escura.</Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              loading={busy}
              disabled={!readable || color.toLowerCase() === saved.toLowerCase()}
              onClick={() => patch({ brandColor: color.toLowerCase() }, "branding.color", "Cor salva.")}
            >
              Salvar cor
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !info.brandColor}
              onClick={() => patch({ brandColor: deleteField() }, "branding.color", "Cor padrão restaurada.")}
            >
              Restaurar padrão
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Pré-visualização</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button">Botão principal</Button>
              <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-800">Destaque</span>
              <span className="text-sm font-medium text-brand-700">Link</span>
            </div>
          </div>
          <Field label="Logo" hint="PNG ou JPG. É reduzido automaticamente.">
            <input ref={fileRef} type="file" accept="image/*" onChange={(e) => onLogo(e.target.files?.[0])} className="block w-full text-sm" />
          </Field>
          {info.logoDataUrl && (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={info.logoDataUrl} alt="Logo da pousada" className="h-16 max-w-48 rounded border border-slate-200 bg-white object-contain p-1" />
              <Button variant="ghost" disabled={busy} onClick={() => patch({ logoDataUrl: deleteField() }, "branding.logo", "Logo removido.")}>
                Remover logo
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function About({ tenantId, uid, info, onNotice }: { tenantId: string; uid: string; info: Info; onNotice: (m: string) => void }) {
  const [description, setDescription] = useState(info.description ?? "");
  const [mapsUrl, setMapsUrl] = useState(info.mapsUrl ?? "");
  const [reminder, setReminder] = useState(info.checkoutReminderText ?? "");
  const [payInfo, setPayInfo] = useState(info.paymentInfo ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const address = [info.address, info.city, info.state].filter(Boolean).join(", ");
  const urlOk = validMapsUrl(mapsUrl.trim());

  async function save() {
    if (!urlOk) return setErr("O link precisa ser do Google Maps (https://maps.app.goo.gl/… ou https://www.google.com/maps/…).");
    setErr("");
    setBusy(true);
    try {
      const { db } = getFirebase();
      await setDoc(
        doc(db, `tenants/${tenantId}/publicInfo/main`),
        {
          description: description.trim().slice(0, 600),
          mapsUrl: mapsUrl.trim() || deleteField(),
          checkoutReminderText: reminder.trim().slice(0, 500) || deleteField(),
          paymentInfo: payInfo.trim().slice(0, 500) || deleteField(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      await audit(tenantId, uid, "publicinfo.update", {});
      onNotice("Descrição e localização salvas.");
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-base font-semibold">Sobre a pousada e localização</h2>
      {err && <Alert>{err}</Alert>}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <Field label="Descrição" hint={`${description.length}/600 caracteres. Aparece para o hóspede.`}>
            <Textarea rows={5} maxLength={600} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field
            label="Link do Google Maps"
            hint="No Google Maps, busque a pousada, toque em Compartilhar e copie o link."
            error={mapsUrl && !urlOk ? "Link inválido: use um endereço do Google Maps (https)." : undefined}
          >
            <Input type="url" value={mapsUrl} onChange={(e) => setMapsUrl(e.target.value)} placeholder="https://maps.app.goo.gl/…" maxLength={500} />
          </Field>
          <Field label="Mensagem do aviso de checkout" hint={`${reminder.length}/500. Mostrada ao hóspede 2 h e 30 min antes da saída. Vazio = mensagem padrão.`}>
            <Textarea rows={3} maxLength={500} value={reminder} onChange={(e) => setReminder(e.target.value)} />
          </Field>
          <Field label="Como pagar (PIX, dados bancários…)" hint={`${payInfo.length}/500. Aparece em "Minha conta" no portal do hóspede. Informe só o que for público.`}>
            <Textarea rows={3} maxLength={500} value={payInfo} onChange={(e) => setPayInfo(e.target.value)} />
          </Field>
          <Button loading={busy} onClick={save}>Salvar</Button>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Mapa</p>
          {address ? (
            <iframe
              title="Mapa da pousada"
              className="h-56 w-full rounded-xl border border-slate-200"
              loading="lazy"
              referrerPolicy="no-referrer"
              src={`https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`}
            />
          ) : (
            <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
              Sem endereço cadastrado para exibir o mapa.
            </p>
          )}
          {info.mapsUrl && validMapsUrl(info.mapsUrl) && (
            <a href={info.mapsUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline">
              Abrir no Google Maps ↗
            </a>
          )}
          <p className="mt-1 text-xs text-slate-500">O mapa usa o endereço cadastrado na criação da pousada.</p>
        </div>
      </div>
    </Card>
  );
}

function Gallery({ tenantId, uid, onNotice }: { tenantId: string; uid: string; onNotice: (m: string) => void }) {
  const { photos, error } = usePhotos(tenantId);
  const { rooms } = useRooms(tenantId);
  const [category, setCategory] = useState<PhotoCategory>("pousada");
  const [roomId, setRoomId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDel, setConfirmDel] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  if (error) return <Alert>{error}</Alert>;
  if (!photos) return <Spinner />;

  const counts = (id: string) => photos.filter((p) => p.category === id).length;
  const shown = photos.filter((p) => p.category === category && (category !== "quarto" || !roomId || p.roomId === roomId));
  const activeRooms = (rooms ?? []).filter((r) => !r.archived);
  const roomLabel = (id?: string) => {
    const r = activeRooms.find((x) => x.id === id) ?? (rooms ?? []).find((x) => x.id === id);
    return r ? `Quarto ${r.number}${r.name ? ` · ${r.name}` : ""}` : "";
  };

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    if (category === "quarto" && !roomId) return setErr("Escolha para qual quarto são as fotos.");
    setErr("");
    setBusy(true);
    let ok = 0;
    try {
      const { db } = getFirebase();
      for (const file of Array.from(files)) {
        if (photos!.length + ok >= MAX_PHOTOS) {
          setErr(`Limite de ${MAX_PHOTOS} fotos atingido. Exclua alguma para adicionar outra.`);
          break;
        }
        const dataUrl = await compressImage(file, { maxSide: 1280, maxChars: 240000 });
        await addDoc(collection(db, `tenants/${tenantId}/photos`), {
          category,
          ...(category === "quarto" ? { roomId } : {}),
          caption: "",
          dataUrl,
          createdBy: uid,
          createdAt: serverTimestamp(),
        });
        ok++;
      }
      if (ok) {
        await audit(tenantId, uid, "photos.add", { category, count: ok });
        onNotice(ok === 1 ? "Foto adicionada." : `${ok} fotos adicionadas.`);
      }
    } catch (e) {
      setErr(e instanceof Error && !(e as { code?: string }).code ? e.message : friendlyError(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function caption(id: string, current: string, value: string) {
    const v = value.trim().slice(0, 120);
    if (v === current) return;
    try {
      const { db } = getFirebase();
      await updateDoc(doc(db, `tenants/${tenantId}/photos/${id}`), { caption: v });
    } catch (e) {
      setErr(friendlyError(e));
    }
  }

  async function remove(id: string) {
    if (confirmDel !== id) return setConfirmDel(id);
    setConfirmDel("");
    try {
      const { db } = getFirebase();
      await deleteDoc(doc(db, `tenants/${tenantId}/photos/${id}`));
      await audit(tenantId, uid, "photos.delete", { photoId: id });
    } catch (e) {
      setErr(friendlyError(e));
    }
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Fotos</h2>
        <span className="text-xs text-slate-500">{photos.length}/{MAX_PHOTOS} fotos</span>
      </div>
      {err && <Alert>{err}</Alert>}

      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {PHOTO_CATEGORIES.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={category === c.id}
            onClick={() => setCategory(c.id)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              category === c.id ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {c.label} ({counts(c.id)})
          </button>
        ))}
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_1fr] sm:items-end">
        {category === "quarto" && (
          <Field label="Quarto">
            <Select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">Todos / escolher…</option>
              {activeRooms.map((r) => (
                <option key={r.id} value={r.id}>{`Quarto ${r.number}${r.name ? ` · ${r.name}` : ""}`}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Adicionar fotos" hint="Várias de uma vez. São reduzidas automaticamente (cerca de 1280 px).">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            disabled={busy}
            onChange={(e) => upload(e.target.files)}
            className="block w-full text-sm"
          />
        </Field>
      </div>
      {busy && <Spinner label="Enviando fotos…" />}

      {shown.length === 0 ? (
        <EmptyState title="Nenhuma foto nesta categoria" text="Adicione fotos acima. Elas aparecem para o hóspede no portal." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p) => (
            <li key={p.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.dataUrl} alt={p.caption || "Foto da pousada"} className="aspect-[4/3] w-full object-cover" loading="lazy" />
              <div className="space-y-2 p-3">
                {p.roomId && <p className="text-xs font-medium text-slate-500">{roomLabel(p.roomId)}</p>}
                <Input
                  defaultValue={p.caption}
                  maxLength={120}
                  placeholder="Legenda (opcional)"
                  aria-label="Legenda da foto"
                  onBlur={(e) => caption(p.id, p.caption, e.target.value)}
                />
                <Button
                  variant={confirmDel === p.id ? "danger" : "ghost"}
                  className="px-3 py-1.5"
                  onClick={() => remove(p.id)}
                  onBlur={() => setConfirmDel("")}
                >
                  {confirmDel === p.id ? "Confirmar exclusão" : "Excluir"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
