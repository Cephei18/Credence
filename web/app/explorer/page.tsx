"use client";

import dynamic from "next/dynamic";

// Client-only: reads the local chain via viem and runs the CRE workflow handler
// in-browser. No SSR (avoids prerender + keeps it out of the build's static pass).
const Explorer = dynamic(() => import("@/components/explorer/Explorer"), {
  ssr: false,
  loading: () => (
    <div className="mx-auto max-w-2xl px-6 py-20 text-center text-sm text-white/40">Loading Credence Explorer…</div>
  ),
});

export default function ExplorerPage() {
  return <Explorer />;
}
