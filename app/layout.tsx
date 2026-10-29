import type { Metadata } from "next";
import { Fraunces, Outfit } from "next/font/google";

import { SHOP } from "@/lib/shop";
import "./globals.css";

const display = Fraunces({ subsets: ["latin"], variable: "--font-display" });
const sans = Outfit({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: `${SHOP.receptionist} Gets Paid — ${SHOP.name}`,
  description: "An AI receptionist that books the visit, takes a PayPal or Venmo deposit, and invoices after the job.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${sans.variable}`}>{children}</body>
    </html>
  );
}
