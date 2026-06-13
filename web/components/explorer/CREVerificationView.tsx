"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Workflow, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { ATT, type CredentialSnapshot, type DemoAgent, type DemoConfig } from "@/lib/credence";
import { verifyLive, type VerifyStep } from "@/lib/creVerify";

const STEPS: { key: VerifyStep; label: string }[] = [
  { key: "request", label: "Emit WorkflowTrigger" },
  { key: "compute", label: "CRE workflow verifies trajectory" },
  { key: "verdict", label: "Verdict" },
  { key: "write", label: "Write verdict on-chain" },
  { key: "done", label: "Credential issued" },
];

export function CREVerificationView({
  demo,
  agent,
  snap,
  onComplete,
}: {
  demo: DemoConfig;
  agent: DemoAgent;
  snap: CredentialSnapshot;
  onComplete: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState<VerifyStep | null>(null);
  const [verdict, setVerdict] = useState<"PASS" | "FAIL" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const researchActive = snap.states[ATT.Research] === 2;
  const riskActive = snap.states[ATT.Risk] === 2;
  const treasuryActive = snap.states[ATT.Treasury] === 2;
  const eligible = researchActive && riskActive && !treasuryActive;

  async function run() {
    setRunning(true);
    setErr(null);
    setVerdict(null);
    try {
      const { verdict } = await verifyLive(demo, agent, ATT.Treasury, (s, d) => {
        setActive(s);
        if (s === "verdict" && d) setVerdict(d as "PASS" | "FAIL");
      });
      setVerdict(verdict ? "PASS" : "FAIL");
      onComplete();
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? "verification failed");
    } finally {
      setRunning(false);
      setActive(null);
    }
  }

  return (
    <div className="card">
      <div className="mb-1 flex items-center gap-2 text-sm uppercase tracking-widest text-white/40">
        <Workflow size={14} /> CRE verification
      </div>
      <p className="mb-3 text-xs text-white/40">
        WorkflowTrigger → CRE workflow → verdict → credential. Runs the real workflow handler in-browser, then writes the
        verdict through CREReceiver.
      </p>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {STEPS.map((s, i) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span
              className="rounded-md px-2 py-1"
              style={{
                background: active === s.key ? "#7c5cff22" : "#ffffff08",
                color: active === s.key ? "#c4b5fd" : "#ffffff66",
              }}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && <span className="text-white/20">→</span>}
          </span>
        ))}
      </div>

      <div className="mt-4">
        {treasuryActive ? (
          <div className="flex items-center gap-2 text-sm text-good">
            <CheckCircle2 size={16} /> Treasury credential active — authority earned.
          </div>
        ) : eligible ? (
          <button className="btn-primary flex items-center gap-2" onClick={run} disabled={running}>
            {running ? <Loader2 size={16} className="animate-spin" /> : <Workflow size={16} />}
            Verify Treasury via CRE
          </button>
        ) : (
          <div className="text-sm text-white/40">
            {agent.flavor === "breaching"
              ? "Prerequisites not met (Risk failed) — Treasury verification unavailable."
              : "Awaiting Research + Risk credentials."}
          </div>
        )}

        {verdict && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 flex items-center gap-2 text-sm"
            style={{ color: verdict === "PASS" ? "#34d399" : "#f87171" }}
          >
            {verdict === "PASS" ? <CheckCircle2 size={16} /> : <XCircle size={16} />} CRE verdict: {verdict}
          </motion.div>
        )}
        {err && <div className="mt-2 text-xs text-bad">{err}</div>}
      </div>
    </div>
  );
}
