"use client";

// Client helpers for the "create your own agent from zero" flow. These drive the
// judge's Privy embedded wallet (the SPONSOR / principal) through the real
// AgentPassport lifecycle. Verdict writes go through the server CRE bridge
// (/api/verify); the operator key is never in the browser.

import {
  createPublicClient,
  createWalletClient,
  http,
  custom,
  defineChain,
  parseEther,
  parseAbi,
  decodeEventLog,
  type PublicClient,
  type WalletClient,
} from "viem";
import { baseSepolia } from "viem/chains";
import type { DemoConfig } from "./credence";

const localChain = defineChain({
  id: 31337,
  name: "Hardhat",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

export function chainFor(chainId: number) {
  return chainId === baseSepolia.id ? baseSepolia : localChain;
}

export function publicFor(cfg: DemoConfig): PublicClient {
  const chain = chainFor(cfg.chainId);
  return createPublicClient({ chain, transport: http() }) as PublicClient;
}

const PASSPORT_ABI = parseAbi([
  "function registerPrincipal() payable",
  "function registerAgent(address wallet) returns (uint256)",
  "function levelUp(uint256 agentId)",
  "function treasuryTier(uint256) view returns (uint8)",
  "function getCredential(uint256) view returns (uint8 level,uint64 verifiedCount,uint64 violations,bool live,bool hasPassport,uint256 spentInEpoch,uint256 spendLimit)",
  "function principals(address) view returns (bool registered,uint256 stake,uint256 agentCount,uint256 slashed)",
]);
const ENGINE_ABI = parseAbi([
  "function listCredentials(uint256) view returns (uint8[6],uint64[6],uint64[6])",
]);
const AGENT_REGISTERED = parseAbi([
  "event AgentRegistered(uint256 indexed agentId,address indexed principal,address wallet)",
])[0];

// Stake at the Verified floor (minStakeForLevel[1]) so the agent can both earn
// its Research credential AND level up to Verified live in the demo.
const STAKE = parseEther("0.01");

export type AgentView = {
  states: number[]; // [Research, Treasury, Prediction, Execution, Governance, Risk]
  level: number; // 0..3
  verifiedCount: number;
  tier: number; // treasury tier 0..3
  spendLimit: bigint;
};

/** Build a viem WalletClient from a Privy embedded wallet's EIP-1193 provider. */
export async function walletFromPrivy(privyWallet: any, cfg: DemoConfig): Promise<WalletClient> {
  const chain = chainFor(cfg.chainId);
  try {
    await privyWallet.switchChain(cfg.chainId);
  } catch {
    /* already on chain, or switch unsupported — proceed */
  }
  const provider = await privyWallet.getEthereumProvider();
  return createWalletClient({
    account: privyWallet.address as `0x${string}`,
    chain,
    transport: custom(provider),
  });
}

/** Ask the demo faucet to top up the sponsor wallet (no-op if already funded). */
export async function ensureFunded(address: string): Promise<void> {
  await fetch("/api/faucet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  }).catch(() => {});
}

/** Register the sponsor (principal) if needed, then mint a fresh tier-0 agent. */
export async function createAgent(
  wallet: WalletClient,
  pub: PublicClient,
  cfg: DemoConfig
): Promise<bigint> {
  const account = wallet.account!.address;
  const chain = chainFor(cfg.chainId);

  const principal = (await pub.readContract({
    address: cfg.contracts.passport,
    abi: PASSPORT_ABI,
    functionName: "principals",
    args: [account],
  })) as readonly [boolean, bigint, bigint, bigint];

  if (!principal[0]) {
    const h = await wallet.writeContract({
      address: cfg.contracts.passport,
      abi: PASSPORT_ABI,
      functionName: "registerPrincipal",
      args: [],
      value: STAKE,
      account: wallet.account!,
      chain,
    });
    await pub.waitForTransactionReceipt({ hash: h });
  }

  const h2 = await wallet.writeContract({
    address: cfg.contracts.passport,
    abi: PASSPORT_ABI,
    functionName: "registerAgent",
    args: [account],
    account: wallet.account!,
    chain,
  });
  const rc = await pub.waitForTransactionReceipt({ hash: h2 });
  for (const log of rc.logs) {
    try {
      const ev = decodeEventLog({ abi: [AGENT_REGISTERED], data: log.data, topics: log.topics });
      if (ev.eventName === "AgentRegistered") return (ev.args as any).agentId as bigint;
    } catch {}
  }
  throw new Error("agent created but AgentRegistered not found");
}

/** Run one independent verification through the server CRE bridge. */
export async function verifyViaBridge(
  agentId: bigint,
  attType: number,
  args: string[]
): Promise<boolean> {
  const res = await fetch("/api/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: agentId.toString(), attType, args }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "verification failed");
  return body.verdict as boolean;
}

/** Permissionlessly promote the agent one level (sponsor pokes it). */
export async function levelUp(
  wallet: WalletClient,
  pub: PublicClient,
  cfg: DemoConfig,
  agentId: bigint
): Promise<void> {
  const h = await wallet.writeContract({
    address: cfg.contracts.passport,
    abi: PASSPORT_ABI,
    functionName: "levelUp",
    args: [agentId],
    account: wallet.account!,
    chain: chainFor(cfg.chainId),
  });
  await pub.waitForTransactionReceipt({ hash: h });
}

export async function readAgent(
  pub: PublicClient,
  cfg: DemoConfig,
  agentId: bigint
): Promise<AgentView> {
  const [list, tier, cred] = await Promise.all([
    pub.readContract({ address: cfg.contracts.engine, abi: ENGINE_ABI, functionName: "listCredentials", args: [agentId] }),
    pub.readContract({ address: cfg.contracts.passport, abi: PASSPORT_ABI, functionName: "treasuryTier", args: [agentId] }),
    pub.readContract({ address: cfg.contracts.passport, abi: PASSPORT_ABI, functionName: "getCredential", args: [agentId] }),
  ]);
  const [states] = list as unknown as [number[], bigint[], bigint[]];
  const c = cred as unknown as [number, bigint, bigint, boolean, boolean, bigint, bigint];
  return {
    states: states.map(Number),
    level: Number(c[0]),
    verifiedCount: Number(c[1]),
    tier: Number(tier),
    spendLimit: c[6],
  };
}
