// Pure Chainlink CRE verification compute — no browser or Node-only APIs, so it
// runs identically in the browser and in a server route. This is the single
// source of truth for "did the behavior satisfy the policy?", mirroring
// contracts/cre/workflow/verify.ts (pinned by the parity tests).

import type { PublicClient } from "viem";
import { ATT } from "./credence";

export type CRECapabilities = {
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

/** Build CRE capabilities backed by any viem PublicClient (browser or server). */
export function viemCaps(client: PublicClient): CRECapabilities {
  return {
    httpGetJson: (url) => fetch(url).then((r) => r.json()),
    ethCall: async (to, data) => {
      const r = await client.call({ to: to as `0x${string}`, data: data as `0x${string}` });
      return (r.data ?? "0x") as string;
    },
    ethGetLogs: (address, topic0, fromBlock, toBlock) =>
      client.request({
        method: "eth_getLogs",
        params: [{ address, topics: [topic0], fromBlock, toBlock } as any],
      }) as any,
  };
}
