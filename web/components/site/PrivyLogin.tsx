"use client";

import { usePrivy } from "@privy-io/react-auth";
import { LogOut, Wallet } from "lucide-react";

/** Privy sign-in for the founder who authorizes agents. Only ever rendered when
 *  NEXT_PUBLIC_PRIVY_APP_ID is set (see Nav), so usePrivy always has a provider. */
export function PrivyLogin() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  if (!ready) return <div className="h-9 w-28 animate-pulse rounded-lg bg-white/5" />;

  if (authenticated) {
    const label =
      user?.email?.address ??
      user?.wallet?.address?.replace(/^(.{6}).+(.{4})$/, "$1…$2") ??
      "Signed in";
    return (
      <button className="btn btn-ghost mono text-xs" onClick={() => logout()} title="Sign out">
        <span className="hidden sm:inline">{label}</span>
        <LogOut size={14} />
      </button>
    );
  }
  return (
    <button className="btn btn-ghost text-sm" onClick={() => login()}>
      <Wallet size={15} />
      Sign in
    </button>
  );
}
