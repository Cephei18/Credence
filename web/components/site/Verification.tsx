"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Link2, BadgeCheck, Loader2, Check, X, Play } from "lucide-react";
import { Section, Reveal } from "./Reveal";
import { ATT } from "@/lib/credence";
import { verifyViaBridge } from "@/lib/sponsor";
import type { Narrative } from "@/lib/narrative";

type VerifyStep = "request" | "trigger" | "compute" | "verdict" | "write" | "done";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const FLOW = [
  { icon: Activity, label: "Behavior", note: "What the agent actually did, on-chain." },
  { icon: Link2, label: "Chainlink verifies", note: "An independent network re-checks it against the rules." },
  { icon: BadgeCheck, label: "Verdict", note: "A tamper-proof PASS or FAIL the agent can't fake." },
];

const STEP_LABEL: Record<VerifyStep, string> = {
  request: "Opening request",
  trigger: "Triggering workflow",
  compute: "Replaying behavior",
  verdict: "Reaching verdict",
  write: "Writing on-chain",
  done: "Done",
};

const SIM_STEPS: VerifyStep[] = ["request", "trigger", "compute", "verdict", "write", "done"];

export function Verification({ narrative, onComplete }: { narrative: Narrative; onComplete?: () => void }) {
  const [target, setTarget] = useState<"alpha" | "beta">("alpha");
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState<VerifyStep | null>(null);
  const [verdict, setVerdict] = useState<"PASS" | "FAIL" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const expected = target === "alpha" ? "PASS" : "FAIL";

  async function run() {
    setRunning(true);
    setErr(null);
    setVerdict(null);
    setStep(null);
    try {
      if (narrative.live && narrative.demo) {
        // Real Chainlink CRE round-trip via the server bridge (operator key stays
        // server-side). Alpha verifies Treasury; Beta re-runs Risk to show FAIL.
        const agent = target === "alpha" ? narrative.alpha.agent : narrative.beta.agent;
        const attType = target === "alpha" ? ATT.Treasury : ATT.Risk;
        const args = [agent.treasury, narrative.demo.abi.treasuryActionTopic0, narrative.demo.abi.getPolicySelector];
        const pending = verifyViaBridge(BigInt(agent.id), attType, args);
        for (const s of SIM_STEPS.slice(0, 5)) {
          setStep(s);
          await sleep(340);
        }
        const ok = await pending;
        setStep("done");
        setVerdict(ok ? "PASS" : "FAIL");
        onComplete?.();
      } else {
        // Illustrative run — same sequence, no chain required.
        for (const s of SIM_STEPS) {
          setStep(s);
          await new Promise((r) => setTimeout(r, 480));
        }
        setVerdict(expected);
      }
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? "verification failed");
    } finally {
      setRunning(false);
      setStep(null);
    }
  }

  return (
    <Section
      id="verification"
      index="03"
      eyebrow="Independent verification"
      title={
        <>
          The agent doesn&apos;t get to grade itself.{" "}
          <span className="text-secondary">Chainlink does.</span>
        </>
      }
      lede="Credence never takes an agent's word for it. A decentralized Chainlink network independently replays the agent's behavior and returns a verdict no one can tamper with."
    >
      {/* the flow */}
      <Reveal>
        <div className="surface flex flex-col items-stretch gap-3 p-5 sm:flex-row sm:items-center sm:p-6">
          {FLOW.map((f, i) => (
            <div key={f.label} className="flex flex-1 items-center gap-3 sm:flex-col sm:items-start">
              <span
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
                style={{ background: "var(--secondary-dim)", color: "var(--secondary)" }}
              >
                <f.icon size={18} />
              </span>
              <div>
                <div className="text-sm font-semibold">{f.label}</div>
                <div className="text-xs leading-snug text-faint">{f.note}</div>
              </div>
              {i < FLOW.length - 1 && (
                <span className="hidden text-faint sm:ml-auto sm:block">→</span>
              )}
            </div>
          ))}
        </div>
      </Reveal>

      {/* interactive run */}
      <Reveal delay={0.1}>
        <div className="surface mt-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">Verify behavior for</span>
              <div className="flex rounded-lg border border-[var(--border-strong)] p-0.5">
                {(["alpha", "beta"] as const).map((t) => (
                  <button
                    key={t}
                    disabled={running}
                    onClick={() => {
                      setTarget(t);
                      setVerdict(null);
                      setErr(null);
                    }}
                    className="rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors"
                    style={{
                      background: target === t ? "var(--surface-2)" : "transparent",
                      color: target === t ? "#fff" : "var(--faint)",
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <button className="btn btn-primary" onClick={run} disabled={running}>
              {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              {running ? "Verifying…" : "Run Chainlink verification"}
            </button>
          </div>

          {/* step trace */}
          <div className="mt-5 flex flex-wrap gap-1.5">
            {SIM_STEPS.map((s) => {
              const active = step === s;
              const done = verdict !== null;
              return (
                <span
                  key={s}
                  className="mono rounded-md px-2.5 py-1 text-[11px] transition-colors"
                  style={{
                    background: active ? "var(--secondary-dim)" : "rgba(255,255,255,0.04)",
                    color: active ? "var(--secondary)" : done ? "rgba(244,246,250,0.5)" : "var(--faint)",
                  }}
                >
                  {STEP_LABEL[s]}
                </span>
              );
            })}
          </div>

          <AnimatePresence>
            {verdict && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-5 flex items-center gap-3 rounded-xl p-4"
                style={{
                  background: verdict === "PASS" ? "var(--accent-dim)" : "var(--fail-dim)",
                  color: verdict === "PASS" ? "var(--accent)" : "var(--fail)",
                }}
              >
                <span className="grid h-8 w-8 place-items-center rounded-full" style={{ background: "rgba(0,0,0,0.25)" }}>
                  {verdict === "PASS" ? <Check size={17} /> : <X size={17} />}
                </span>
                <div>
                  <div className="text-sm font-semibold">Chainlink verdict: {verdict}</div>
                  <div className="text-xs opacity-80">
                    {verdict === "PASS"
                      ? "Behavior matched the rules. Credential can advance."
                      : "Behavior broke the rules. Credential is denied."}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {err && <div className="mt-3 text-xs text-fail">{err}</div>}
          {!narrative.live && (
            <div className="mt-4 text-xs text-faint">
              Showing an illustrative run. Start the local chain to execute a real Chainlink CRE
              round-trip.
            </div>
          )}
        </div>
      </Reveal>
    </Section>
  );
}
