"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, reload, signOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import type { Role, TenantInfo } from "@/lib/types";

export interface Membership {
  tenantId: string;
  role: Role;
  name?: string;
}

interface AuthState {
  loading: boolean;
  user: User | null;
  emailVerified: boolean;
  membership: Membership | null;
  tenant: TenantInfo | null;
  /** Relê o usuário (e-mail verificado) e a pousada. */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

async function loadMembership(user: User): Promise<{ membership: Membership | null; tenant: TenantInfo | null }> {
  const { db } = getFirebase();
  const idx = await getDoc(doc(db, `users/${user.uid}`));
  if (!idx.exists()) return { membership: null, tenant: null };

  const tenantId = idx.data().tenantId as string | undefined;
  if (!tenantId) return { membership: null, tenant: null };

  try {
    const [m, t] = await Promise.all([
      getDoc(doc(db, `tenants/${tenantId}/members/${user.uid}`)),
      getDoc(doc(db, `tenants/${tenantId}`)),
    ]);
    if (!m.exists() || m.data().active !== true || !t.exists()) return { membership: null, tenant: null };
    const td = t.data();
    return {
      membership: { tenantId, role: m.data().role as Role, name: m.data().name as string | undefined },
      tenant: {
        id: tenantId,
        name: td.name as string,
        displayName: td.displayName as string | undefined,
        status: td.status as string,
        planId: td.planId as string,
      },
    };
  } catch {
    // Sem permissão (membro desativado ou pousada suspensa): trata como sem vínculo.
    return { membership: null, tenant: null };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);

  const apply = useCallback(async (u: User | null) => {
    setUser(u);
    setEmailVerified(u?.emailVerified ?? false);
    // Hóspede (login anônimo do portal) nunca tem vínculo com a equipe.
    if (!u || u.isAnonymous) {
      setMembership(null);
      setTenant(null);
      return;
    }
    const r = await loadMembership(u);
    setMembership(r.membership);
    setTenant(r.tenant);
  }, []);

  useEffect(() => {
    const { auth } = getFirebase();
    return onAuthStateChanged(auth, async (u) => {
      setLoading(true);
      try {
        await apply(u);
      } finally {
        setLoading(false);
      }
    });
  }, [apply]);

  const refresh = useCallback(async () => {
    const { auth } = getFirebase();
    const u = auth.currentUser;
    if (!u) return;
    await reload(u);
    // Renova o token para que o e-mail verificado passe a valer nas Rules.
    await u.getIdToken(true);
    await apply(auth.currentUser);
  }, [apply]);

  const logout = useCallback(async () => {
    const { auth } = getFirebase();
    await signOut(auth);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ loading, user, emailVerified, membership, tenant, refresh, logout }),
    [loading, user, emailVerified, membership, tenant, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}

const FRIENDLY: Record<string, string> = {
  "auth/invalid-credential": "E-mail ou senha incorretos.",
  "auth/wrong-password": "E-mail ou senha incorretos.",
  "auth/user-not-found": "E-mail ou senha incorretos.",
  "auth/invalid-email": "E-mail inválido.",
  "auth/email-already-in-use": "Este e-mail já tem cadastro. Use “Entrar”.",
  "auth/weak-password": "Senha fraca. Use pelo menos 8 caracteres.",
  "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
  "auth/network-request-failed": "Sem conexão com a internet. Tente novamente.",
  "auth/operation-not-allowed": "Login por e-mail/senha não está ativado no Firebase.",
  "permission-denied": "Sem permissão para esta ação.",
};

export function friendlyError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  return FRIENDLY[code] ?? FRIENDLY[code.replace("firestore/", "")] ?? "Algo deu errado. Tente novamente.";
}
