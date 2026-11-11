import type { Metadata, Viewport } from "next";
import { BRAND } from "@/config/brand";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { RegisterSW } from "@/components/RegisterSW";
import "./globals.css";

// Fontes do sistema: sem requisições a terceiros (privacidade do portal do hóspede)
// e o build funciona offline.
export const metadata: Metadata = {
  title: BRAND.name,
  description: BRAND.tagline,
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
  appleWebApp: { capable: true, title: BRAND.name, statusBarStyle: "default" },
};
export const viewport: Viewport = { themeColor: "#0f766e" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-900">
        <AuthProvider>{children}</AuthProvider>
        <RegisterSW />
      </body>
    </html>
  );
}
