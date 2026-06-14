"use client";

import { ShieldCheck } from "lucide-react";
import { PrivyLogin } from "./PrivyLogin";

const LINKS = [
  { href: "#experiment", label: "Experiment" },
  { href: "#behavior", label: "Behavior" },
  { href: "#verification", label: "Verification" },
  { href: "#authority", label: "Authority" },
  { href: "#launch", label: "Try it" },
];

const PRIVY_ON = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[rgba(7,9,14,0.72)] backdrop-blur-xl">
      <nav className="mx-auto flex max-w-narrative items-center justify-between px-6 py-3.5">
        <a href="#top" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--accent-dim)] text-accent">
            <ShieldCheck size={17} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Credence</span>
        </a>
        <div className="hidden items-center gap-7 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-sm text-muted transition-colors hover:text-white">
              {l.label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-1.5 text-xs text-faint sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
            Verified by Chainlink CRE
          </span>
          {PRIVY_ON && <PrivyLogin />}
        </div>
      </nav>
    </header>
  );
}
