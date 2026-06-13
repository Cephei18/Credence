import {
  createWalletClient,
  http,
  keccak256,
  toHex,
  encodeAbiParameters,
  decodeEventLog,
  zeroHash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  publicClient,
  localChain,
  PASSPORT_ABI,
  CRE_ABI,
  WORKFLOW_TRIGGER_EVENT,
  ATT,
  type DemoConfig,
  type DemoAgent,
} from "./credence";

// ── CRE capabilities (browser, viem-backed) ───────────────────────────────
// Mirror of contracts/cre/workflow/verify.ts. Single source of truth is the
// contracts copy (pinned by the parity tests); this is the browser runtime.
type CRECapabilities = {
  httpGetJson(url: string): Promise<any>;
  ethCall(to: string, data: string): Promise<string>;
  ethGetLogs(address: string, topic0: string, fromBlock: string, toBlock: string): Promise<{ data: string }[]>;
};

function word(hex: string, i: number): bigint {
  const start = 2 + i * 64;
  return BigInt("0x" + hex.slice(start, start + 64));
}

export async function runVerification(
  attType: number,
  args: string[],
  caps: CRECapabilities
): Promise<boolean> {
  if (attType === ATT.Research) {
    const [assetPair, direction, target, deadline] = args;
    if (Math.floor(Date.now() / 1000) < Number(deadline)) return false;
    const body = await caps.httpGetJson(`https://api.coinbase.com/v2/prices/${assetPair}/spot`);
    const spot = Number(body.data.amount);
    return direction === "up" ? spot >= Number(target) : spot <= Number(target);
  }
  // risk / treasury
  const [treasury, topic0, getPolicySelector] = args;
  const policyHex = await caps.ethCall(treasury, getPolicySelector);
  const policyMinStableBps = word(policyHex, 0);
  const capitalFloorUsd = word(policyHex, 1);
  const policyMinEndBps = word(policyHex, 2);
  const startValueUsd = word(policyHex, 3);
  const startBlock = word(policyHex, 6);

  const logs = await caps.ethGetLogs(treasury, topic0, "0x" + startBlock.toString(16), "latest");
  if (!logs || logs.length === 0) return false;

  let minStableBps = 10000n;
  let minValueUsd = 1n << 255n;
  let endValueUsd = 0n;
  for (const l of logs) {
    const totalValueUsd = word(l.data, 4);
    const stableBps = word(l.data, 5);
    if (stableBps < minStableBps) minStableBps = stableBps;
    if (totalValueUsd < minValueUsd) minValueUsd = totalValueUsd;
    endValueUsd = totalValueUsd;
  }
  if (attType === ATT.Risk) return minStableBps >= policyMinStableBps;
  return minValueUsd >= capitalFloorUsd && endValueUsd >= (startValueUsd * policyMinEndBps) / 10000n;
}

function browserCaps(): CRECapabilities {
  return {
    httpGetJson: (url) => fetch(url).then((r) => r.json()),
    ethCall: async (to, data) => {
      const r = await publicClient.call({ to: to as `0x${string}`, data: data as `0x${string}` });
      return (r.data ?? "0x") as string;
    },
    ethGetLogs: (address, topic0, fromBlock, toBlock) =>
      publicClient.request({
        method: "eth_getLogs",
        params: [{ address, topics: [topic0], fromBlock, toBlock } as any],
      }) as any,
  };
}

// Well-known Hardhat account #0 — the seed's workflowSender. LOCAL DEMO ONLY.
const DEMO_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

export type VerifyStep = "request" | "trigger" | "compute" | "verdict" | "write" | "done";

/// Live CRE verification for the demo: open a typed request, run the real
/// workflow handler in-browser, then write the verdict as workflowSender.
export async function verifyLive(
  d: DemoConfig,
  agent: DemoAgent,
  attType: number,
  onStep?: (s: VerifyStep, detail?: string) => void
): Promise<{ requestId: string; verdict: boolean }> {
  if (d.chainId !== 31337) throw new Error("live verify is local-demo only");
  const account = privateKeyToAccount(DEMO_KEY);
  const wallet = createWalletClient({ account, chain: localChain, transport: http() });

  const args =
    attType === ATT.Research
      ? agent.researchArgs
      : [agent.treasury, d.abi.treasuryActionTopic0, d.abi.getPolicySelector];

  const taskId = keccak256(toHex(`live:${agent.id}:${attType}:${Date.now()}`));
  const payload = encodeAbiParameters([{ type: "string[]" }], [args]);

  onStep?.("request");
  const reqHash = await wallet.writeContract({
    address: d.contracts.passport,
    abi: PASSPORT_ABI,
    functionName: "requestTypedVerification",
    args: [BigInt(agent.id), attType, taskId, payload, zeroHash],
  });
  const reqReceipt = await publicClient.waitForTransactionReceipt({ hash: reqHash });

  onStep?.("trigger");
  let requestId: string | undefined;
  for (const log of reqReceipt.logs) {
    try {
      const ev = decodeEventLog({ abi: [WORKFLOW_TRIGGER_EVENT], data: log.data, topics: log.topics });
      if (ev.eventName === "WorkflowTrigger") requestId = (ev.args as any).requestId;
    } catch {}
  }
  if (!requestId) throw new Error("no WorkflowTrigger");

  onStep?.("compute");
  const verdict = await runVerification(attType, args, browserCaps());
  onStep?.("verdict", verdict ? "PASS" : "FAIL");

  onStep?.("write");
  const writeHash = await wallet.writeContract({
    address: d.contracts.creReceiver,
    abi: CRE_ABI,
    functionName: "fulfillFromWorkflow",
    args: [requestId as `0x${string}`, verdict],
  });
  await publicClient.waitForTransactionReceipt({ hash: writeHash });

  onStep?.("done");
  return { requestId, verdict };
}
