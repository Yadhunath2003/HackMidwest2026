// Font setup for src/app/layout.tsx — the variables are read by tokens.css (@theme inline).
import type { Metadata } from "next";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const sourceSerif = Source_Serif_4({ subsets: ["latin"], variable: "--font-source-serif" });

export const metadata: Metadata = {
  title: "StrategyLab AI",
  description: "Describe it. Backtest it. Understand it. Validate it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Dark by default; switch to className="light" for the light theme.
    <html lang="en" className={`dark ${geist.variable} ${geistMono.variable} ${sourceSerif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
