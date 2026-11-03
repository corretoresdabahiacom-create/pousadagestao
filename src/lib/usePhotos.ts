"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";

export const PHOTO_CATEGORIES = [
  { id: "pousada", label: "Pousada" },
  { id: "quarto", label: "Quartos" },
  { id: "refeitorio", label: "Refeitório" },
  { id: "garagem", label: "Garagem" },
  { id: "area_comum", label: "Áreas comuns" },
  { id: "entorno", label: "Localização e entorno" },
  { id: "outros", label: "Outras" },
] as const;

export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number]["id"];

export interface Photo {
  id: string;
  category: PhotoCategory;
  roomId?: string;
  caption: string;
  dataUrl: string;
  createdMs: number;
}

/** Fotos da pousada em tempo real (mais antigas primeiro). */
export function usePhotos(tenantId: string | undefined) {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!tenantId) return;
    const { db } = getFirebase();
    return onSnapshot(
      collection(db, `tenants/${tenantId}/photos`),
      (snap) => {
        const list = snap.docs.map((d) => {
          const x = d.data({ serverTimestamps: "estimate" });
          return {
            id: d.id,
            category: x.category as PhotoCategory,
            roomId: x.roomId as string | undefined,
            caption: (x.caption as string) ?? "",
            dataUrl: x.dataUrl as string,
            createdMs: x.createdAt?.toMillis?.() ?? 0,
          } satisfies Photo;
        });
        list.sort((a, b) => a.createdMs - b.createdMs);
        setPhotos(list);
      },
      () => setError("Não foi possível carregar as fotos."),
    );
  }, [tenantId]);

  return { photos, error };
}
