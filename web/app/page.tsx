"use client";

import dynamic from "next/dynamic";

// Credence is a single-scroll narrative: Behavior → Verification → Credential →
// Authority. Client-only: it reads the chain via viem and runs the Chainlink CRE
// workflow handler in-browser, with a graceful fallback when no chain is up.
const Credence = dynamic(() => import("@/components/site/Credence"), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-screen place-items-center text-sm text-faint">Loading Credence…</div>
  ),
});

export default function Home() {
  return <Credence />;
}
