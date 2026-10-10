import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StrategyLab AI",
  description: "Describe it. Backtest it. Understand it. Validate it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
