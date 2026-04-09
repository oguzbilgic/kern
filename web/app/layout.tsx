import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "kern",
  description: "Agent runtime",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-dvh overflow-hidden flex">{children}</body>
    </html>
  );
}
