import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Credence — authority for AI agents, earned through verified behavior",
  description:
    "Identity shouldn't grant authority. Behavior earns it. Credence is the authority layer for AI agents, with verification by Chainlink CRE.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
