"use client";

import { motion } from "framer-motion";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import { CREDENTIAL_STATE, LEVELS, TREASURY_TIER_LABEL, ATT, type CredentialSnapshot, type DemoAgent } from "@/lib/credence";

const STATE_STYLE: Record<string, string> = {
  None: "text-white/30 border-white/10",
  Pending: "text-warn border-warn/40 bg-warn/10",
  Active: "text-good border-good/40 bg-good/10",
  Suspended: "text-warn border-warn/40 bg-warn/10",
  Revoked: "text-bad border-bad/40 bg-bad/10",
  Expired: "text-white/40 border-white/10",
};

function CredentialChip({ label, state }: { label: string; state: number }) {
  const name = CREDENTIAL_STATE[state] ?? "None";
  return (
    <div className={`rounded-xl border px-3 py-2 ${STATE_STYLE[name]}`}>
      <div className="text-[11px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-sm font-semibold">{name}</div>
    </div>
  );
}

export function PassportExplorer({ agent, snap }: { agent: DemoAgent; snap: CredentialSnapshot }) {
  const compliant = agent.flavor === "compliant";
  const tierColor = snap.tier >= 2 ? "#34d399" : snap.tier === 1 ? "#fbbf24" : "#9aa0aa";
  return (
    <motion.div layout className="card relative overflow-hidden">
      <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full blur-3xl opacity-25" style={{ background: tierColor }} />
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-white/40">
            <ShieldCheck size={14} /> Agent Passport
          </div>
          <div className="mt-1 text-2xl font-semibold">{agent.name}</div>
          <div className="mt-1 text-sm text-white/40">
            Level {LEVELS[snap.level]} · verifications {snap.verifiedCount.toString()} ·{" "}
            <span className={snap.violations > 0n ? "text-bad" : ""}>violations {snap.violations.toString()}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-white/40">Treasury tier</div>
          <div className="text-3xl font-bold" style={{ color: tierColor }}>{snap.tier}</div>
          <div className="text-xs" style={{ color: tierColor }}>{TREASURY_TIER_LABEL[snap.tier]}</div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        <CredentialChip label="Research" state={snap.states[ATT.Research]} />
        <CredentialChip label="Risk" state={snap.states[ATT.Risk]} />
        <CredentialChip label="Treasury" state={snap.states[ATT.Treasury]} />
      </div>

      <div
        className="mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
        style={{ background: compliant ? "#34d39912" : "#f8717112", color: compliant ? "#34d399" : "#f87171" }}
      >
        {compliant ? <ShieldCheck size={15} /> : <AlertTriangle size={15} />}
        {compliant ? "Disciplined agent — behavior verified across the window." : "Breaching agent — policy violated; authority withheld."}
      </div>
    </motion.div>
  );
}
