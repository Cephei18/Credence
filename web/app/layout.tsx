import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Agent Passport — credential infrastructure for autonomous agents",
  description:
    "Autonomous agents earn delegated authority through independently verified behavior.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-mono antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
