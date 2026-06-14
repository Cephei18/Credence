"use client";

// Narrative data layer for the Credence story page.
//
// Primary source is the live chain (via lib/credence). But a judge may open the
// app with no local node running, so we degrade gracefully to a representative
// dataset that tells the exact same Alpha-vs-Beta story. `live` records which
// path we took so the UI can be honest about it.

import {
  loadDemo,
  readCredentialSnapshot,
  readTrajectory,
  ATT,
  type DemoConfig,
  type DemoAgent,
  type CredentialSnapshot,
  type TrajectoryPoint,
} from "./credence";

export type AgentNarrative = {
  agent: DemoAgent;
  snap: CredentialSnapshot;
  points: TrajectoryPoint[];
  policy: { minStableBps: number; capitalFloorUsd: bigint; startValueUsd: bigint };
};

export type Narrative = {
  live: boolean;
  demo: DemoConfig | null;
  alpha: AgentNarrative;
  beta: AgentNarrative;
};

// 80% stable-allocation floor on a $100k treasury — the committed policy.
const FLOOR_BPS = 8000;
const FLOOR_USD = 80000n * 100000000n;
const START_USD = 100000n * 100000000n;

function fallbackSnap(kind: "alpha" | "beta"): CredentialSnapshot {
  const alpha = kind === "alpha";
  // states index: [Research, Treasury, Prediction, Execution, Governance, Risk]
  const states = alpha ? [2, 2, 0, 0, 0, 2] : [2, 0, 0, 0, 0, 3];
  return {
    states,
    verifications: [0n, 0n, 0n, 0n, 0n, 0n],
    activeMask: alpha ? 0b100011n : 0b000001n,
    tier: alpha ? 3 : 0,
    tierCap: alpha ? 25000n * 100000000n : 0n,
    rights: {
      spendLimitPerEpoch: alpha ? 25000n * 100000000n : 0n,
      canDelegate: alpha,
      treasuryAccess: alpha,
      governanceAccess: false,
    },
    level: alpha ? 2 : 0,
    verifiedCount: alpha ? 3n : 1n,
    violations: alpha ? 0n : 1n,
  };
}

function curve(bpsAt: number[]): TrajectoryPoint[] {
  // total value tracks loosely with how disciplined the allocation is
  return bpsAt.map((stableBps, i) => ({
    stableBps,
    totalValueUsd: BigInt(Math.round((95000 + (stableBps - 8000) / 4) * 1e8)),
    timestamp: i,
    actionType: 1,
  }));
}

function fallbackNarrative(): Narrative {
  const mkAgent = (id: string, name: string, flavor: DemoAgent["flavor"]): DemoAgent => ({
    id,
    name,
    flavor,
    treasury: "0x0000000000000000000000000000000000000000",
    operator: "0x0000000000000000000000000000000000000000",
    researchArgs: [],
  });
  const policy = { minStableBps: FLOOR_BPS, capitalFloorUsd: FLOOR_USD, startValueUsd: START_USD };
  return {
    live: false,
    demo: null,
    alpha: {
      agent: mkAgent("1", "Agent Alpha", "compliant"),
      snap: fallbackSnap("alpha"),
      points: curve([8600, 8550, 8700, 8400, 8650, 8800, 8500, 8600]),
      policy,
    },
    beta: {
      agent: mkAgent("2", "Agent Beta", "breaching"),
      snap: fallbackSnap("beta"),
      points: curve([8500, 8200, 7600, 6900, 5800, 5100, 4800, 5200]),
      policy,
    },
  };
}

async function liveAgent(d: DemoConfig, agent: DemoAgent): Promise<AgentNarrative> {
  const [snap, traj] = await Promise.all([
    readCredentialSnapshot(d, BigInt(agent.id)),
    readTrajectory(d, agent),
  ]);
  return {
    agent,
    snap,
    points: traj.points,
    policy: {
      minStableBps: Number(traj.policy.minStableBps),
      capitalFloorUsd: traj.policy.capitalFloorUsd as bigint,
      startValueUsd: traj.policy.startValueUsd as bigint,
    },
  };
}

export async function loadNarrative(): Promise<Narrative> {
  let demo: DemoConfig | null = null;
  try {
    demo = await loadDemo();
  } catch {
    return fallbackNarrative(); // no demo.json at all
  }
  try {
    const alphaCfg = demo.agents.find((a) => a.flavor === "compliant") ?? demo.agents[0];
    const betaCfg = demo.agents.find((a) => a.flavor === "breaching") ?? demo.agents[1];
    const [alpha, beta] = await Promise.all([liveAgent(demo, alphaCfg), liveAgent(demo, betaCfg)]);
    // a live read with no trajectory points means the chain isn't seeded —
    // fall back so the story is never blank.
    if (alpha.points.length === 0 && beta.points.length === 0) return { ...fallbackNarrative(), demo };
    return { live: true, demo, alpha, beta };
  } catch {
    // Chain reads failed (e.g. Base Sepolia via a local reader), but we still
    // have the real deployment config — keep it so the launch flow works.
    return { ...fallbackNarrative(), demo };
  }
}

// ── credential helpers (shared, jargon-free) ──────────────────────────────
export const CREDENTIAL_DEFS = [
  {
    key: "research",
    idx: ATT.Research,
    label: "Research",
    line: "The agent made checkable predictions — and they came true.",
  },
  {
    key: "risk",
    idx: ATT.Risk,
    label: "Risk",
    line: "The agent kept the treasury inside the rules it agreed to.",
  },
  {
    key: "treasury",
    idx: ATT.Treasury,
    label: "Treasury",
    line: "Proven discipline unlocks the right to move real money.",
  },
] as const;

export function stateName(s: number): "earned" | "denied" | "pending" | "none" {
  if (s === 2) return "earned";
  if (s === 3 || s === 4) return "denied";
  if (s === 1) return "pending";
  return "none";
}

export function worstStableBps(points: TrajectoryPoint[]): number {
  return points.length ? Math.min(...points.map((p) => p.stableBps)) : 10000;
}
