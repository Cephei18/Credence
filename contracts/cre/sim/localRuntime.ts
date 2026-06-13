// Local CRE simulation runtime — runs the workflow handler today with NO CRE
// deployment, approval, subscription, or external infra. Capabilities are backed
// by the same canned fixtures used to validate source.js, so the CRE workflow is
// exercised against identical data.

import { encodePolicy, encodeActionLog, PolicyFixture, Trajectory } from "../../scripts/lib/functionsSim";
import { CRECapabilities, WorkflowTrigger, AttestationType } from "../workflow/creTypes";

export type Scenario = { policy?: PolicyFixture; trajectory?: Trajectory; spot?: number };

/// Capabilities backed by canned scenario data (offline, deterministic).
export function buildCaps(s: Scenario): CRECapabilities {
  return {
    async httpGetJson(url: string) {
      if (url.includes("coinbase")) return { data: { amount: String(s.spot ?? 0) } };
      return {};
    },
    async ethCall(_to: string, _data: string) {
      return encodePolicy(s.policy!);
    },
    async ethGetLogs() {
      return (s.trajectory ?? []).map((p) => encodeActionLog(p.value, p.stableBps));
    },
  };
}

/// Build a decoded trigger (mirrors what CREReceiver.WorkflowTrigger would emit).
export function buildTrigger(attType: AttestationType, args: string[]): WorkflowTrigger {
  return {
    requestId: "0x" + "11".repeat(32),
    agentId: 1n,
    attType,
    taskId: "0x" + "22".repeat(32),
    args,
  };
}

// Canonical inner args (no category prefix — category is attType).
export const RISK_ARGS = ["0xTreasury", "0xTopic0", "0xGetPolicySel"];
export const TREASURY_ARGS = RISK_ARGS;
