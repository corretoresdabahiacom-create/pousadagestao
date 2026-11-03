import type { Metadata } from "next";
import { BRAND } from "@/config/brand";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import "./globals.css";

// Fontes do sistema: sem requisições a terceiros (privacidade do portal do hóspede)
// e o build funciona offline.
export const metadata: Metadata = {
  title: BRAND.name,
  description: BRAND.tagline,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-900">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
