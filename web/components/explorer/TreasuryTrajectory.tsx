"use client";

import { MiniChart } from "./MiniChart";
import { fmtUsd, bpsToPct, type TrajectoryPoint } from "@/lib/credence";

export function TreasuryTrajectory({ points, policy }: { points: TrajectoryPoint[]; policy: any }) {
  const minStableBps = Number(policy.minStableBps);
  const floorUsd = policy.capitalFloorUsd as bigint;
  const startUsd = policy.startValueUsd as bigint;

  const stableSeries = points.map((p) => p.stableBps);
  const valueSeries = points.map((p) => Number(p.totalValueUsd) / 1e8);

  const breached = stableSeries.some((b) => b < minStableBps);
  const worst = stableSeries.length ? Math.min(...stableSeries) : 10000;
  const stableFloor = bpsToPct(minStableBps);
  const consequence = breached
    ? "Consequence: Risk attestation fails, credentials are suspended, and treasury authority stays locked."
    : "Consequence: behavior satisfies the policy path and can be verified into treasury authority.";

  return (
    <div className="card">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-sm uppercase tracking-widest text-white/40">1 · Behavior — Treasury trajectory</div>
        <span
          className="pill text-xs"
          style={{
            color: breached ? "#f87171" : "#34d399",
            borderColor: breached ? "#f8717155" : "#34d39955",
            background: breached ? "#f8717112" : "#34d39912",
          }}
        >
          {breached ? "policy breached" : "policy respected"}
        </span>
      </div>
      <p className="mb-2 text-xs text-white/40">
        Policy: stable allocation must never fall below {stableFloor}. Chainlink verifies the whole window, not a snapshot.
      </p>
      <p className="mb-3 text-xs text-white/40">
        Worst stable ratio: <span className={breached ? "text-bad" : "text-good"}>{bpsToPct(worst)}</span>. {consequence}
      </p>

      <div className="space-y-4">
        <MiniChart
          values={stableSeries}
          floor={minStableBps}
          yMin={0}
          yMax={10000}
          color="#22d3ee"
          label={`Stable allocation (floor ${bpsToPct(minStableBps)})`}
          format={(v) => bpsToPct(v)}
        />
        <MiniChart
          values={valueSeries}
          floor={Number(floorUsd) / 1e8}
          yMin={Number(floorUsd) / 1e8 - 5000}
          yMax={Number(startUsd) / 1e8 + 5000}
          color="#7c5cff"
          label={`Portfolio value (floor ${fmtUsd(floorUsd)})`}
          format={(v) => `$${(v / 1000).toFixed(0)}k`}
        />
      </div>
    </div>
  );
}
