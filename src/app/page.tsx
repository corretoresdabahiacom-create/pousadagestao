"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Spinner } from "@/components/ui";

// Porta de entrada: encaminha conforme a situação do usuário.
export default function Home() {
  const { loading, user, membership } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login/");
    else if (membership) router.replace("/painel/");
    else router.replace("/onboarding/");
  }, [loading, user, membership, router]);

  return <Spinner />;
}
