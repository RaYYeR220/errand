import type { Metadata } from "next";
import { Instrument_Serif, Inter_Tight, Fragment_Mono } from "next/font/google";
import "./globals.css";

const serif = Instrument_Serif({ variable: "--font-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });
const sans = Inter_Tight({ variable: "--font-inter-tight", subsets: ["latin"], weight: ["400", "500", "600"] });
const mono = Fragment_Mono({ variable: "--font-fragment-mono", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: "Errand",
  description:
    "A purchasing agent that works signed in to your supplier portals and never sees the passwords. Every browser runs in its own microVM on Vultr; the order waits for your approval.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
