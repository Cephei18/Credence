"use client";

import dynamic from "next/dynamic";

// The flow uses Privy + wagmi hooks that must run only in the browser, so load
// it with ssr:false — keeps it out of the static prerender pass at build time.
const PassportFlow = dynamic(() => import("@/components/PassportFlow"), {
  ssr: false,
  loading: () => (
    <div className="mx-auto max-w-2xl px-6 py-20 text-center text-sm text-white/40">
      Loading Agent Passport…
    </div>
  ),
});

export default function Home() {
  return <PassportFlow />;
}
