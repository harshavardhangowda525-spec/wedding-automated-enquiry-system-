import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "WeddingFlow AI", template: "%s · WeddingFlow AI" },
  description: "Every enquiry tracked. Every follow-up remembered. Enquiry and follow-up automation for wedding photography and cinematography studios, by Infinity Web & Apps.",
  applicationName: "WeddingFlow AI",
};

export const viewport: Viewport = {
  themeColor: "#fbf8f3",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
