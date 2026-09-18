import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_NAME = "Benchmark Review Intelligence 🇨🇱";
const SITE_DESCRIPTION =
  "Analiza y compara reseñas de apps del App Store con IA: sentimiento, quejas recurrentes, features pedidas y rankings por categoría.";

// ALV-84: metadataBase resolves every relative URL below (og:url, and the
// og:image/twitter:image Next.js injects automatically from
// app/opengraph-image.tsx) into an absolute one. NEXT_PUBLIC_SITE_URL isn't
// set yet in this project's .env.local — set it to the real deployed
// origin (e.g. https://review-bi.vercel.app) once one exists; until then
// this falls back to localhost, which is harmless in dev but means shared
// links won't carry a real og:url/og:image host in production.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: "/",
    siteName: SITE_NAME,
    locale: "es_CL",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
