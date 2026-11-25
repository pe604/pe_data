import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Jost, Source_Serif_4 } from "next/font/google";
import { connection } from "next/server";
import { fundingOnly } from "@/lib/env";
import "./globals.css";

// SPEC §11: Hanken Grotesk for the UI and data (tabular figures), Jost for the wordmark, counts and titles,
// Source Serif 4 for long reading text (Funding letters, analyst reads).
const sans = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-sans",
  display: "swap",
});

const display = Jost({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-display",
  display: "swap",
});

const serif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: fundingOnly ? "Niveshaay Funding Tracker" : "Niveshaay PE Desk",
  description: fundingOnly ? "Indian startup and growth equity rounds, with a monthly letter" : "The Niveshaay private equity team's desk for every deal",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render every page per request so the CSP nonce from src/proxy.ts is applied (static pages can't get one).
  await connection();
  return (
    // suppressHydrationWarning: browser extensions (QuillBot, Grammarly) add attributes to <html> before React loads.
    // It only affects this element's attributes, not the app below it.
    <html lang="en" className={`${sans.variable} ${display.variable} ${serif.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
