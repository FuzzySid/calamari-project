import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Calamari",
  description: "A clickable globe and story experience for Spain's defining era."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
