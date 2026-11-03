"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import { BRAND } from "@/config/brand";
import { getFirebase } from "@/lib/firebase/client";
import { friendlyError, useAuth } from "@/lib/auth/AuthProvider";
import { Alert, Button, Card, Field, Input, Spinner } from "@/components/ui";

type Mode = "login" | "signup" | "reset";

/** Só aceita caminhos internos como destino após o login (evita redirecionamento externo). */
function safeNext(next: string | null): string | null {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const { loading, user } = useAuth();

  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    if (!loading && user) router.replace(next ?? "/");
  }, [loading, user, next, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setBusy(true);
    const { auth } = getFirebase();
    try {
      if (mode === "login") {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else if (mode === "signup") {
        if (name.trim().length < 3) throw { code: "app/name" };
        if (password.length < 8) throw { code: "auth/weak-password" };
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(cred.user, { displayName: name.trim() });
        await sendEmailVerification(cred.user);
      } else {
        await sendPasswordResetEmail(auth, email.trim());
        setInfo("Se este e-mail tiver cadastro, enviamos um link para criar uma nova senha.");
        setMode("login");
      }
    } catch (err) {
      setError((err as { code?: string }).code === "app/name" ? "Informe seu nome completo." : friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading || user) return <Spinner />;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-teal-800">{BRAND.name}</h1>
        <p className="mt-1 text-sm text-slate-600">{BRAND.tagline}</p>
      </div>

      <Card>
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm font-medium">
          {(["login", "signup"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError("");
                setInfo("");
              }}
              className={`rounded-md py-2 transition ${mode === m ? "bg-white text-teal-800 shadow-sm" : "text-slate-600"}`}
            >
              {m === "login" ? "Entrar" : "Criar conta"}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {mode === "signup" && (
            <Field label="Seu nome completo">
              <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
            </Field>
          )}
          <Field label="E-mail">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </Field>
          {mode !== "reset" && (
            <Field label="Senha" hint={mode === "signup" ? "Mínimo de 8 caracteres." : undefined}>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
              />
            </Field>
          )}

          {error && <Alert>{error}</Alert>}
          {info && <Alert kind="success">{info}</Alert>}

          <Button type="submit" loading={busy} className="w-full">
            {mode === "login" ? "Entrar" : mode === "signup" ? "Criar conta" : "Enviar link"}
          </Button>

          {mode === "login" && (
            <button type="button" onClick={() => setMode("reset")} className="block w-full text-center text-sm text-teal-700 hover:underline">
              Esqueci minha senha
            </button>
          )}
          {mode === "reset" && (
            <button type="button" onClick={() => setMode("login")} className="block w-full text-center text-sm text-teal-700 hover:underline">
              Voltar
            </button>
          )}
        </form>
      </Card>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <LoginForm />
    </Suspense>
  );
}
