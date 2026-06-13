import { CRECapabilities, WorkflowTrigger, AttestationType } from "./creTypes";

// Credence CRE verification handler — a faithful port of contracts/chainlink/source.js.
// The verification RULES are unchanged; only the runtime harness differs (CRE
// capabilities instead of the Functions `Functions.*` globals). It returns the
// boolean verdict the workflow then writes via CREReceiver.fulfillFromWorkflow.
//
// NOTE the arg indexing: under Functions, args[0] was the injected category and
// the real args started at args[1]. Under CRE the category arrives as
// trigger.attType, so trigger.args holds the inner args directly (index 0-based).

const COINBASE = "https://api.coinbase.com/v2/prices";

function word(hex: string, i: number): bigint {
  const start = 2 + i * 64;
  return BigInt("0x" + hex.slice(start, start + 64));
}

async function verifyResearch(t: WorkflowTrigger, caps: CRECapabilities): Promise<boolean> {
  const assetPair = t.args[0]; // e.g. "ETH-USD"
  const direction = t.args[1]; // "up" | "down"
  const target = Number(t.args[2]);
  const deadline = Number(t.args[3]);

  // The forecast must have matured (committed before, judged after).
  if (Math.floor(Date.now() / 1000) < deadline) return false;

  const body = await caps.httpGetJson(`${COINBASE}/${assetPair}/spot`);
  const spot = Number(body.data.amount);
  return direction === "up" ? spot >= target : spot <= target;
}

async function verifyBehavior(t: WorkflowTrigger, caps: CRECapabilities, mode: "risk" | "treasury"): Promise<boolean> {
  const treasury = t.args[0];
  const topic0 = t.args[1];
  const getPolicySelector = t.args[2];

  // 1) Read the COMMITTED policy from chain (not from the agent).
  const policyHex = await caps.ethCall(treasury, getPolicySelector);
  const policyMinStableBps = word(policyHex, 0);
  const capitalFloorUsd = word(policyHex, 1);
  const policyMinEndBps = word(policyHex, 2);
  const startValueUsd = word(policyHex, 3);
  const startBlock = word(policyHex, 6);

  // 2) Read the full TreasuryAction trajectory since the window opened.
  const logs = await caps.ethGetLogs(treasury, topic0, "0x" + startBlock.toString(16), "latest");
  if (!logs || logs.length === 0) return false; // no behavior → cannot attest

  // 3) Reconstruct worst-case metrics across the WHOLE window.
  //    data words: [actionType, stableBalance, volatileBalance, ethUsdPrice,
  //                 totalValueUsd, stableBps, timestamp]
  let minStableBps = 10000n;
  let minValueUsd = 1n << 255n;
  let endValueUsd = 0n;
  for (let k = 0; k < logs.length; k++) {
    const d = logs[k].data;
    const totalValueUsd = word(d, 4);
    const stableBps = word(d, 5);
    if (stableBps < minStableBps) minStableBps = stableBps;
    if (totalValueUsd < minValueUsd) minValueUsd = totalValueUsd;
    endValueUsd = totalValueUsd; // chronological order
  }

  if (mode === "risk") {
    return minStableBps >= policyMinStableBps;
  }
  // treasury (stewardship)
  const floorOk = minValueUsd >= capitalFloorUsd;
  const endOk = endValueUsd >= (startValueUsd * policyMinEndBps) / 10000n;
  return floorOk && endOk;
}

/// Produce the verdict for a decoded WorkflowTrigger. Identical rules to source.js.
export async function runVerification(t: WorkflowTrigger, caps: CRECapabilities): Promise<boolean> {
  if (t.attType === AttestationType.Research) return verifyResearch(t, caps);
  if (t.attType === AttestationType.Risk) return verifyBehavior(t, caps, "risk");
  if (t.attType === AttestationType.Treasury) return verifyBehavior(t, caps, "treasury");
  throw new Error(`unsupported attType ${t.attType}`);
}
