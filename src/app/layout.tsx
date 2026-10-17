import type { Metadata, Viewport } from "next";
import { Lato } from "next/font/google";
import { Suspense } from "react";
import { Providers } from "@/components/providers";
import { DemoBanner } from "@/components/layout/demo-banner";
import "./globals.css";

const lato = Lato({ variable: "--font-lato", subsets: ["latin"], weight: ["400", "700", "900"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "RestaurantOS — Scan. Order. Pay. Served.", template: "%s · RestaurantOS" },
  description: "Multi-tenant restaurant ordering, payments and kitchen operations platform.",
  applicationName: "RestaurantOS",
};

export const viewport: Viewport = {
  themeColor: "#1c2940",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${lato.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a href="#main" className="sr-only z-50 rounded-lg bg-navy-900 px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
          Skip to content
        </a>
        <Suspense fallback={null}>
          <DemoBanner />
        </Suspense>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
