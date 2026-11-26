import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { RoleProvider } from "@/context/RoleContext";
import { AdaptiveAppShell } from "@/components/AdaptiveAppShell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "StockIA Bolivia - Gestión Inteligente",
  description:
    "Controla tus productos, protege tus ganancias. Inventario con voz e IA para comercios.",
  manifest: "/manifest.json",
  applicationName: "StockIA",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "StockIA",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#10563E",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <RoleProvider>
          <Suspense
            fallback={
              <div className="min-h-screen flex items-center justify-center bg-background text-brand-primary font-semibold">
                Cargando StockIA Bolivia...
              </div>
            }
          >
            <AdaptiveAppShell>{children}</AdaptiveAppShell>
          </Suspense>
        </RoleProvider>
      </body>
    </html>
  );
}
