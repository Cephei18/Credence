"use client";

import { Zap, Users, Coins, Vote, Check, X } from "lucide-react";
import { fmtUsd, TREASURY_TIER_LABEL, type CredentialSnapshot } from "@/lib/credence";

function Right({ icon, label, on }: { icon: React.ReactNode; label: string; on: boolean }) {
  return (
    <div
      className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
      style={{ borderColor: on ? "#34d39955" : "#ffffff14", background: on ? "#34d39912" : "transparent", color: on ? "#34d399" : "#ffffff55" }}
    >
      {icon}
      <span>{label}</span>
      <span className="ml-auto text-xs">{on ? "granted" : "locked"}</span>
    </div>
  );
}

export function AuthorityPanel({ snap }: { snap: CredentialSnapshot }) {
  const { tier, tierCap, rights } = snap;
  const unlocked =
    tier === 0
      ? "No treasury authority"
      : tier === 1
      ? "Simulation-only treasury access"
      : tier === 2
      ? `Small execution up to ${fmtUsd(tierCap)}`
      : `Higher-value execution up to ${fmtUsd(tierCap)}`;
  const explanation =
    tier === 0
      ? "No value-bearing treasury action can pass the protocol chokepoint."
      : tier === 1
      ? "Risk credential is active, so the agent may simulate allocations but cannot move value."
      : tier === 2
      ? "Treasury credential is active, so capped execution is allowed."
      : "Research, Risk, and Treasury credentials are active, so the full treasury pathway has unlocked higher-value execution.";
  // Treasury action capability by tier (mirrors attemptTreasuryAction).
  const actions =
    tier === 0
      ? [{ ok: false, text: "Treasury actions blocked (no authority)" }]
      : tier === 1
      ? [
          { ok: true, text: "Simulate allocations (value = 0)" },
          { ok: false, text: "Execute any value transfer" },
        ]
      : [
          { ok: true, text: `Execute up to ${fmtUsd(tierCap)} per action` },
          { ok: false, text: `Execute above ${fmtUsd(tierCap)}` },
        ];

  return (
    <div className="card">
      <div className="mb-3 text-sm uppercase tracking-widest text-white/40">Authority unlocked</div>

      <div className="rounded-lg border border-edge bg-black/20 px-3 py-2">
        <div className="text-[11px] uppercase tracking-wide text-white/40">Treasury tier {tier}</div>
        <div className="text-sm font-semibold">{unlocked}</div>
        <div className="mt-1 text-xs text-white/45">{explanation}</div>
      </div>

      <div className="mb-2 mt-4 text-[11px] uppercase tracking-wide text-white/40">Secondary passport rights</div>
      <div className="grid grid-cols-2 gap-2">
        <Right icon={<Zap size={14} />} label="Base spend" on={rights.spendLimitPerEpoch > 0n} />
        <Right icon={<Users size={14} />} label="Delegation" on={rights.canDelegate} />
        <Right icon={<Coins size={14} />} label="Treasury path" on={tier > 0} />
        <Right icon={<Vote size={14} />} label="Governance" on={rights.governanceAccess} />
      </div>

      <div className="mt-3 text-xs text-white/40">Treasury-specific authority is credential-derived: {TREASURY_TIER_LABEL[tier]}.</div>

      <div className="mt-3 space-y-1.5">
        {actions.map((a, i) => (
          <div key={i} className="flex items-center gap-2 text-sm" style={{ color: a.ok ? "#34d399" : "#f87171" }}>
            {a.ok ? <Check size={14} /> : <X size={14} />}
            {a.text}
          </div>
        ))}
      </div>
    </div>
  );
}
