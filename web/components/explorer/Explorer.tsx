"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, RefreshCw } from "lucide-react";
import {
  loadDemo,
  readCredentialSnapshot,
  readHistory,
  readTrajectory,
  type DemoConfig,
  type DemoAgent,
  type CredentialSnapshot,
  type Attestation,
  type Violation,
  type TrajectoryPoint,
} from "@/lib/credence";
import { PassportExplorer } from "./PassportExplorer";
import { AuthorityPanel } from "./AuthorityPanel";
import { TreasuryTrajectory } from "./TreasuryTrajectory";
import { CredentialTimeline } from "./CredentialTimeline";
import { CREVerificationView } from "./CREVerificationView";

type AgentData = {
  snap: CredentialSnapshot;
  attestations: Attestation[];
  violations: Violation[];
  points: TrajectoryPoint[];
  policy: any;
};

export default function Explorer() {
  const [demo, setDemo] = useState<DemoConfig | null>(null);
  const [agent, setAgent] = useState<DemoAgent | null>(null);
  const [data, setData] = useState<AgentData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadDemo()
      .then((d) => {
        setDemo(d);
        setAgent(d.agents[0]);
      })
      .catch((e) => setError(e.message));
  }, []);

  const refresh = useCallback(async (d: DemoConfig, a: DemoAgent) => {
    setLoading(true);
    try {
      const [snap, hist, traj] = await Promise.all([
        readCredentialSnapshot(d, BigInt(a.id)),
        readHistory(d, BigInt(a.id)),
        readTrajectory(d, a),
      ]);
      setData({ snap, attestations: hist.attestations, violations: hist.violations, points: traj.points, policy: traj.policy });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (demo && agent) refresh(demo, agent);
  }, [demo, agent, refresh]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent/20 text-accent">
            <ShieldCheck />
          </div>
          <div>
            <div className="text-lg font-semibold">Credence Explorer</div>
            <div className="mt-1 max-w-2xl text-sm text-white/55">
              Agents do not get treasury power because they have a wallet. They earn it from independently verified behavior.
            </div>
            <div className="text-xs text-white/40">Behavior -&gt; Verification -&gt; Credential -&gt; Authority</div>
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-edge bg-black/20 px-2 py-1 text-[11px] text-white/55">
              Verification powered by Chainlink CRE
            </div>
          </div>
        </div>
        {demo && (
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {demo.agents.map((a) => {
              const sel = agent?.id === a.id;
              const compliant = a.flavor === "compliant";
              const outcome = compliant ? "earned authority" : "authority withheld";
              return (
                <button
                  key={a.id}
                  onClick={() => setAgent(a)}
                  title={compliant ? "Alpha respected the treasury policy and can earn authority." : "Beta breached the treasury policy and authority is withheld."}
                  className="rounded-xl border px-3 py-2 text-sm transition"
                  style={{
                    borderColor: sel ? (compliant ? "#34d39966" : "#f8717166") : "#23232f",
                    background: sel ? (compliant ? "#34d39912" : "#f8717112") : "transparent",
                  }}
                >
                  {a.name} <span className="text-white/40">· {outcome}</span>
                </button>
              );
            })}
            <button className="btn-ghost" onClick={() => demo && agent && refresh(demo, agent)} title="refresh">
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        )}
      </header>

      {error && (
        <div className="mt-6 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          {error} — is the local chain up and seeded? <code>npm --workspace contracts run seed:demo</code>
        </div>
      )}

      {demo && agent && data && (
        <section className="mt-8 space-y-6">
          <div className="rounded-xl border border-edge bg-black/20 px-4 py-3 text-sm text-white/60">
            <span className="font-medium text-white/80">Judge frame:</span> Same $100k treasury, same 80% stable-allocation floor,
            different behavior. Credence decides which agent earns authority.
          </div>
          <PassportExplorer agent={agent} snap={data.snap} />
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-6">
              <TreasuryTrajectory points={data.points} policy={data.policy} />
              <CREVerificationView demo={demo} agent={agent} snap={data.snap} onComplete={() => refresh(demo, agent)} />
            </div>
            <div className="space-y-6">
              <CredentialTimeline attestations={data.attestations} violations={data.violations} />
              <AuthorityPanel snap={data.snap} />
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
