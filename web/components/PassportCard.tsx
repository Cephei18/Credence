"use client";

import { motion } from "framer-motion";
import { ShieldCheck, Zap, Coins, Vote, Users } from "lucide-react";
import { LEVELS } from "@/lib/contracts";
import { LEVEL_COLORS, short } from "@/lib/utils";
import { formatEther } from "viem";

export type Credential = {
  level: number;
  verifiedCount: bigint;
  violations: bigint;
  live: boolean;
  hasPassport: boolean;
  spentInEpoch: bigint;
  spendLimit: bigint;
};

export type Rights = {
  spendLimitPerEpoch: bigint;
  canDelegate: boolean;
  treasuryAccess: boolean;
  governanceAccess: boolean;
};

export function PassportCard({
  agentId,
  wallet,
  passportName,
  cred,
  rights,
}: {
  agentId?: bigint;
  wallet?: string;
  passportName?: string;
  cred?: Credential;
  rights?: Rights;
}) {
  const level = cred?.level ?? 0;
  const color = LEVEL_COLORS[level];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="card relative overflow-hidden"
      style={{ borderColor: `${color}55` }}
    >
      <div
        className="absolute -right-16 -top-16 h-48 w-48 rounded-full blur-3xl opacity-30"
        style={{ background: color }}
      />
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-white/40">
            Agent Passport
          </div>
          <div className="mt-1 text-2xl font-semibold">
            {passportName || (agentId ? `agent #${agentId}` : "—")}
          </div>
          <div className="mt-1 text-sm text-white/40">{short(wallet)}</div>
        </div>
        <div
          className="pill"
          style={{ color, borderColor: `${color}66`, background: `${color}14` }}
        >
          <ShieldCheck size={14} /> {LEVELS[level]}
        </div>
      </div>

      {/* progression bar */}
      <div className="mt-6 flex gap-1.5">
        {LEVELS.map((l, i) => (
          <div
            key={l}
            className="h-1.5 flex-1 rounded-full"
            style={{ background: i <= level ? LEVEL_COLORS[i] : "#ffffff14" }}
          />
        ))}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <Stat label="Verified outcomes" value={(cred?.verifiedCount ?? 0n).toString()} />
        <Stat
          label="Violations"
          value={(cred?.violations ?? 0n).toString()}
          danger={(cred?.violations ?? 0n) > 0n}
        />
        <Stat
          label="Credential"
          value={cred ? (cred.live ? "Live" : "Decayed") : "—"}
          danger={cred ? !cred.live : false}
        />
        <Stat
          label="Spend / epoch"
          value={rights ? `${formatEther(rights.spendLimitPerEpoch)} ETH` : "—"}
        />
      </div>

      {/* rights */}
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Right icon={<Zap size={14} />} label="Spending" on={(rights?.spendLimitPerEpoch ?? 0n) > 0n} />
        <Right icon={<Users size={14} />} label="Delegation" on={!!rights?.canDelegate} />
        <Right icon={<Coins size={14} />} label="Treasury" on={!!rights?.treasuryAccess} />
        <Right icon={<Vote size={14} />} label="Governance" on={!!rights?.governanceAccess} />
      </div>
    </motion.div>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-edge bg-black/20 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-white/40">{label}</div>
      <div className={danger ? "text-bad" : "text-white"}>{value}</div>
    </div>
  );
}

function Right({ icon, label, on }: { icon: React.ReactNode; label: string; on: boolean }) {
  return (
    <div
      className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"
      style={{
        borderColor: on ? "#34d39955" : "#ffffff14",
        background: on ? "#34d39912" : "transparent",
        color: on ? "#34d399" : "#ffffff55",
      }}
    >
      {icon}
      <span>{label}</span>
      <span className="ml-auto text-xs">{on ? "granted" : "locked"}</span>
    </div>
  );
}
