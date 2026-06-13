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
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent/20 text-accent">
            <ShieldCheck />
          </div>
          <div>
            <div className="text-lg font-semibold">Credence Explorer</div>
            <div className="text-xs text-white/40">Behavior → Verification → Credential → Authority</div>
          </div>
        </div>
        {demo && (
          <div className="flex items-center gap-2">
            {demo.agents.map((a) => {
              const sel = agent?.id === a.id;
              const compliant = a.flavor === "compliant";
              return (
                <button
                  key={a.id}
                  onClick={() => setAgent(a)}
                  className="rounded-xl border px-3 py-2 text-sm transition"
                  style={{
                    borderColor: sel ? (compliant ? "#34d39966" : "#f8717166") : "#23232f",
                    background: sel ? (compliant ? "#34d39912" : "#f8717112") : "transparent",
                  }}
                >
                  {a.name} <span className="text-white/40">· {a.flavor}</span>
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
