import type { NextConfig } from "next";

// Plano gratuito do Firebase: sem servidor Next.js. O app é exportado como site estático
// (pasta "out") e publicado no Firebase Hosting; os dados vêm do Firestore pelo navegador.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
