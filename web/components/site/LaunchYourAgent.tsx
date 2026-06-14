"use client";

import { useMemo, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { motion, AnimatePresence } from "framer-motion";
import { Wallet, Sparkles, Loader2, Check, X, Play, ArrowRight, RotateCcw } from "lucide-react";
import { Section, Reveal } from "./Reveal";
import { ATT, LEVELS, fmtEthAuthority } from "@/lib/credence";
import {
  walletFromPrivy,
  ensureFunded,
  createAgent,
  verifyViaBridge,
  levelUp,
  readAgent,
  publicFor,
  type AgentView,
} from "@/lib/sponsor";
import type { DemoConfig } from "@/lib/credence";

const PRIVY_ON = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const RESEARCH_ARGS = ["ETH-USD", "up", "1", "0"]; // trivially-true forecast (pipeline demo)

type Phase = "ready" | "creating" | "zero" | "verifying" | "earned";

const CREDS = [
  { idx: ATT.Research, label: "Research" },
  { idx: ATT.Risk, label: "Risk" },
  { idx: ATT.Treasury, label: "Treasury" },
];

function CredChip({ label, active }: { label: string; active: boolean }) {
  return (
    <div
      className="flex items-center justify-between rounded-xl border px-3 py-2.5 transition-colors"
      style={{
        borderColor: active ? "rgba(52,211,153,0.3)" : "var(--border)",
        background: active ? "var(--accent-dim)" : "transparent",
      }}
    >
      <span className="text-sm font-medium" style={{ color: active ? "var(--accent)" : "var(--faint)" }}>
        {label}
      </span>
      <span style={{ color: active ? "var(--accent)" : "var(--faint)" }}>
        {active ? <Check size={15} /> : <X size={15} />}
      </span>
    </div>
  );
}

function PassportCard({ view, name }: { view: AgentView; name: string }) {
  const levelName = LEVELS[view.level] ?? "Unverified";
  return (
    <div className="surface p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="eyebrow">Your agent</div>
          <div className="mt-1 text-lg font-semibold tracking-tight">{name}</div>
        </div>
        <div className="text-right">
          <div className="eyebrow">Level</div>
          <motion.div
            key={view.level}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-lg font-semibold"
            style={{ color: view.level > 0 ? "var(--accent)" : "var(--faint)" }}
          >
            {levelName}
          </motion.div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {CREDS.map((c) => (
          <CredChip key={c.label} label={c.label} active={view.states[c.idx] === 2} />
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between rounded-xl border border-[var(--border)] px-3 py-2.5">
        <span className="text-sm text-muted">Spend authority / epoch</span>
        <motion.span
          key={view.spendLimit.toString()}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mono text-sm font-semibold"
          style={{ color: view.level > 0 ? "var(--accent)" : "var(--text)" }}
        >
          {fmtEthAuthority(view.spendLimit)}
        </motion.span>
      </div>
    </div>
  );
}

function LaunchInner({ cfg }: { cfg: DemoConfig }) {
  const { authenticated, login, user } = usePrivy();
  const { wallets } = useWallets();
  const pub = useMemo(() => publicFor(cfg), [cfg]);

  const [phase, setPhase] = useState<Phase>("ready");
  const [agentId, setAgentId] = useState<bigint | null>(null);
  const [view, setView] = useState<AgentView | null>(null);
  const [step, setStep] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  const embedded = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const agentName = useMemo(() => `Agent-${(user?.id ?? "demo").slice(-4)}`, [user?.id]);

  async function create() {
    if (!embedded) return;
    setErr(null);
    setPhase("creating");
    try {
      setStep("Funding your sponsor wallet");
      await ensureFunded(embedded.address);
      const wallet = await walletFromPrivy(embedded, cfg);
      setStep("Minting your Agent Passport");
      const id = await createAgent(wallet, pub, cfg);
      setAgentId(id);
      const v = await readAgent(pub, cfg, id);
      setView(v);
      setPhase("zero");
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? "could not create agent");
      setPhase("ready");
    }
  }

  async function earn() {
    if (!embedded || agentId == null) return;
    setErr(null);
    setPhase("verifying");
    try {
      const wallet = await walletFromPrivy(embedded, cfg);
      setStep("Chainlink verifying research · 1 of 2");
      await verifyViaBridge(agentId, ATT.Research, RESEARCH_ARGS);
      setStep("Chainlink verifying research · 2 of 2");
      await verifyViaBridge(agentId, ATT.Research, RESEARCH_ARGS);
      setStep("Claiming earned authority");
      try {
        await levelUp(wallet, pub, cfg, agentId);
      } catch {
        /* level-up is a bonus; the credential is already earned either way */
      }
      const v = await readAgent(pub, cfg, agentId);
      setView(v);
      setPhase("earned");
    } catch (e: any) {
      const msg = e?.shortMessage ?? e?.message ?? "verification failed";
      const stale = /doesn't exist|UnknownAgent|0x0df2949d/.test(msg);
      setErr(stale ? "This agent is no longer on the chain (it was reset). Click “Create my agent” to start fresh." : msg);
      // If the agent vanished (chain reseeded), drop back so the user can recreate.
      if (stale) {
        setAgentId(null);
        setView(null);
        setPhase("ready");
      } else {
        setPhase("zero");
      }
    }
  }

  function reset() {
    setAgentId(null);
    setView(null);
    setErr(null);
    setPhase("ready");
  }

  // ── render ────────────────────────────────────────────────────────────
  if (!authenticated) {
    return (
      <div className="surface flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-base font-semibold">Sign in to start from zero</div>
          <p className="mt-1 text-sm text-muted">
            Privy gives you an embedded wallet — your on-chain identity as the agent&apos;s sponsor.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => login()}>
          <Wallet size={15} /> Sign in with Privy
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* left: action */}
      <div className="surface flex flex-col p-6">
        <div className="eyebrow">{user?.email?.address ?? embedded?.address?.replace(/^(.{6}).+(.{4})$/, "$1…$2") ?? "Signed in"}</div>

        {phase === "ready" && (
          <>
            <div className="mt-2 text-lg font-semibold">Create a brand-new agent</div>
            <p className="mt-1 text-sm text-muted">
              It starts with nothing: no credentials, no authority. Then it earns its way up — live.
            </p>
            <button className="btn btn-primary mt-5 self-start" onClick={create} disabled={!embedded}>
              <Sparkles size={15} /> Create my agent
            </button>
          </>
        )}

        {(phase === "creating" || phase === "verifying") && (
          <div className="mt-2 flex flex-col items-start gap-3">
            <div className="text-lg font-semibold">
              {phase === "creating" ? "Creating your agent…" : "Earning the first credential…"}
            </div>
            <div className="flex items-center gap-2 text-sm text-secondary">
              <Loader2 size={15} className="animate-spin" /> {step}
            </div>
          </div>
        )}

        {phase === "zero" && (
          <>
            <div className="mt-2 text-lg font-semibold">It exists — and it has zero authority</div>
            <p className="mt-1 text-sm text-muted">
              Now make it prove something. Chainlink will independently verify a research claim; two
              passes earn its first credential.
            </p>
            <button className="btn btn-primary mt-5 self-start" onClick={earn}>
              <Play size={15} /> Run verification
            </button>
          </>
        )}

        {phase === "earned" && (
          <>
            <div className="mt-2 flex items-center gap-2 text-lg font-semibold text-accent">
              <Check size={18} /> Authority earned
            </div>
            <p className="mt-1 text-sm text-muted">
              Your agent went from nothing to a verified credential and a real spend envelope — every
              step independently verified, nothing self-reported.
            </p>
            <button className="btn btn-ghost mt-5 self-start" onClick={reset}>
              <RotateCcw size={15} /> Start another from zero
            </button>
          </>
        )}

        {err && <div className="mt-4 text-xs text-fail">{err}</div>}
      </div>

      {/* right: live passport */}
      <div>
        <AnimatePresence mode="wait">
          {view ? (
            <motion.div key="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <PassportCard view={view} name={agentName} />
              {phase === "earned" && (
                <Reveal>
                  <div className="surface mt-3 flex items-center justify-center gap-2 p-3 text-center text-sm text-muted">
                    Behavior <ArrowRight size={13} className="text-faint" /> Verification{" "}
                    <ArrowRight size={13} className="text-faint" /> Credential{" "}
                    <ArrowRight size={13} className="text-faint" />{" "}
                    <span className="font-semibold text-accent">Authority</span>
                  </div>
                </Reveal>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="placeholder"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="surface grid h-full min-h-[220px] place-items-center p-6 text-center text-sm text-faint"
            >
              Your agent&apos;s passport will appear here, starting at zero.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function LaunchYourAgent({ cfg }: { cfg: DemoConfig | null }) {
  return (
    <Section
      id="launch"
      index="06"
      eyebrow="Now you try"
      title="Create an agent from zero. Watch it earn authority."
      lede="Everything above is real and on-chain. So is this: sign in, mint a fresh agent with no credentials, and verify it into its first real authority — in under a minute."
    >
      <Reveal>
        {!PRIVY_ON ? (
          <div className="surface p-6 text-sm text-muted">
            <span className="font-semibold text-white">Privy isn&apos;t configured.</span> Set{" "}
            <code>NEXT_PUBLIC_PRIVY_APP_ID</code> to enable the live from-zero flow. The seeded
            Alpha/Beta story above runs without it.
          </div>
        ) : !cfg ? (
          <div className="surface p-6 text-sm text-muted">
            <span className="font-semibold text-white">No deployment found.</span> Seed a chain (
            <code>npm --workspace contracts run seed:demo</code>) so a fresh agent can be created
            against the real contracts.
          </div>
        ) : (
          <LaunchInner cfg={cfg} />
        )}
      </Reveal>
    </Section>
  );
}
