"use client";

import { useEffect, useState } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider, createConfig } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http } from "wagmi";
import { baseSepolia, hardhatLocal } from "@/lib/contracts";

const queryClient = new QueryClient();

// Privy provisions an embedded wallet for the founder; wagmi talks to chain.
const wagmiConfig = createConfig({
  chains: [baseSepolia, hardhatLocal],
  transports: {
    [baseSepolia.id]: http(),
    [hardhatLocal.id]: http("http://127.0.0.1:8545"),
  },
});

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

export function Providers({ children }: { children: React.ReactNode }) {
  // Mount guard: never instantiate Privy/Wagmi during SSR or prerender (Privy
  // throws on an empty app id at build time). The provider tree is client-only.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <>{children}</>;

  if (!PRIVY_APP_ID) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center text-sm text-white/60">
        Set <code>NEXT_PUBLIC_PRIVY_APP_ID</code> in <code>web/.env.local</code> to run the demo.
      </div>
    );
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: { theme: "dark", accentColor: "#7c5cff", logo: undefined },
        // Auto-provision an embedded wallet so the founder can authorize agents
        // without bringing their own wallet — the "who authorized this agent?"
        // anchor for the whole credential system.
        embeddedWallets: { createOnLogin: "users-without-wallets" },
        loginMethods: ["email", "wallet", "google"],
        defaultChain: baseSepolia,
        supportedChains: [baseSepolia, hardhatLocal],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
