import { createPublicClient, http, parseAbi, defineChain } from "viem";

// The Explorer reads the local Hardhat chain directly (no wallet required).
export const localChain = defineChain({
  id: 31337,
  name: "Hardhat",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

export const publicClient = createPublicClient({ chain: localChain, transport: http() });

// ---- demo dataset (written by contracts/scripts/seedDemo.ts) ----
export type DemoAgent = {
  id: string;
  name: string;
  flavor: "compliant" | "breaching";
  treasury: `0x${string}`;
  operator: `0x${string}`;
  researchArgs: string[];
};
export type DemoConfig = {
  chainId: number;
  contracts: { passport: `0x${string}`; engine: `0x${string}`; registry: `0x${string}`; creReceiver: `0x${string}`; feed: `0x${string}` };
  workflowSender: `0x${string}`;
  abi: { treasuryActionTopic0: `0x${string}`; getPolicySelector: `0x${string}` };
  agents: DemoAgent[];
};

let _demo: DemoConfig | null = null;
export async function loadDemo(): Promise<DemoConfig> {
  if (_demo) return _demo;
  const res = await fetch("/demo.json", { cache: "no-store" });
  if (!res.ok) throw new Error("demo.json not found — run `npm --workspace contracts run seed:demo`");
  _demo = (await res.json()) as DemoConfig;
  return _demo;
}

// ---- ABIs (minimal, human-readable) ----
export const PASSPORT_ABI = parseAbi([
  "function getCredential(uint256) view returns (uint8 level,uint64 verifiedCount,uint64 violations,bool live,bool hasPassport,uint256 spentInEpoch,uint256 spendLimit)",
  "function getRights(uint256) view returns ((uint256 spendLimitPerEpoch,bool canDelegate,bool treasuryAccess,bool governanceAccess))",
  "function treasuryTier(uint256) view returns (uint8)",
  "function treasuryTierCap(uint256) view returns (uint256)",
  "function requestTypedVerification(uint256,uint8,bytes32,bytes,bytes32) returns (bytes32)",
]);

export const ENGINE_ABI = parseAbi([
  "function listCredentials(uint256) view returns (uint8[6],uint64[6],uint64[6])",
  "function getVerificationHistory(uint256) view returns ((uint8 vType,bool outcome,int8 credentialImpact,uint64 timestamp,address verifierSource,bytes32 taskId,bytes32 metadata)[])",
  "function getViolations(uint256) view returns ((uint64 timestamp,uint8 severity,address reporter,string reason)[])",
  "function activeCredentialMask(uint256) view returns (uint256)",
]);

export const TREASURY_ABI = parseAbi([
  "function getPolicy() view returns ((uint16 minStableBps,uint256 capitalFloorUsd,uint16 minEndBps,uint256 startValueUsd,uint64 windowStart,uint64 windowEnd,uint64 startBlock))",
  "function currentValuation() view returns (uint256 stableUsd,uint256 volatileUsd,uint256 totalUsd,uint16 stableBps,uint256 price)",
  "function worstStableBps() view returns (uint16)",
  "function worstValueUsd() view returns (uint256)",
]);

export const CRE_ABI = parseAbi(["function fulfillFromWorkflow(bytes32,bool)"]);

export const TREASURY_ACTION_EVENT = parseAbi([
  "event TreasuryAction(uint256 indexed agentId,uint8 actionType,uint256 stableBalance,uint256 volatileBalance,uint256 ethUsdPrice,uint256 totalValueUsd,uint16 stableBps,uint64 timestamp)",
])[0];

export const WORKFLOW_TRIGGER_EVENT = parseAbi([
  "event WorkflowTrigger(bytes32 indexed requestId,uint256 indexed agentId,uint8 attType,bytes32 taskId,string[] args)",
])[0];

// ---- domain constants ----
export const CREDENTIAL_TYPES = ["Research", "Treasury", "Prediction", "Execution", "Governance", "Risk"] as const;
export const CREDENTIAL_STATE = ["None", "Pending", "Active", "Suspended", "Revoked", "Expired"] as const;
export const LEVELS = ["Unverified", "Verified", "Trusted", "Autonomous"] as const;
export const TREASURY_TIER_LABEL = ["No authority", "Simulation only", "Small execution", "Higher-value execution"] as const;
export const ATT = { Research: 0, Treasury: 1, Prediction: 2, Execution: 3, Governance: 4, Risk: 5 } as const;

// USD is feed-decimals (8). Format to a readable dollar string.
export function fmtUsd(v: bigint): string {
  const dollars = Number(v) / 1e8;
  return dollars.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
export function bpsToPct(bps: number | bigint): string {
  return `${(Number(bps) / 100).toFixed(1)}%`;
}

// ---- read helpers ----
export type CredentialSnapshot = {
  states: number[];
  verifications: bigint[];
  activeMask: bigint;
  tier: number;
  tierCap: bigint;
  rights: { spendLimitPerEpoch: bigint; canDelegate: boolean; treasuryAccess: boolean; governanceAccess: boolean };
  level: number;
  verifiedCount: bigint;
  violations: bigint;
};

export async function readCredentialSnapshot(d: DemoConfig, agentId: bigint): Promise<CredentialSnapshot> {
  const [list, mask, tier, rights, cred] = await Promise.all([
    publicClient.readContract({ address: d.contracts.engine, abi: ENGINE_ABI, functionName: "listCredentials", args: [agentId] }),
    publicClient.readContract({ address: d.contracts.engine, abi: ENGINE_ABI, functionName: "activeCredentialMask", args: [agentId] }),
    publicClient.readContract({ address: d.contracts.passport, abi: PASSPORT_ABI, functionName: "treasuryTier", args: [agentId] }),
    publicClient.readContract({ address: d.contracts.passport, abi: PASSPORT_ABI, functionName: "getRights", args: [agentId] }),
    publicClient.readContract({ address: d.contracts.passport, abi: PASSPORT_ABI, functionName: "getCredential", args: [agentId] }),
  ]);
  const tierCap = await publicClient.readContract({ address: d.contracts.passport, abi: PASSPORT_ABI, functionName: "treasuryTierCap", args: [BigInt(tier)] });
  const [states, , verifications] = list as unknown as [number[], bigint[], bigint[]];
  return {
    states: states.map(Number),
    verifications: (verifications as bigint[]),
    activeMask: mask as bigint,
    tier: Number(tier),
    tierCap: tierCap as bigint,
    rights: rights as any,
    level: Number((cred as any)[0]),
    verifiedCount: (cred as any)[1],
    violations: (cred as any)[2],
  };
}

export type Attestation = { vType: number; outcome: boolean; credentialImpact: number; timestamp: bigint; verifierSource: string; taskId: string; metadata: string };
export type Violation = { timestamp: bigint; severity: number; reporter: string; reason: string };

export async function readHistory(d: DemoConfig, agentId: bigint): Promise<{ attestations: Attestation[]; violations: Violation[] }> {
  const [att, vio] = await Promise.all([
    publicClient.readContract({ address: d.contracts.engine, abi: ENGINE_ABI, functionName: "getVerificationHistory", args: [agentId] }),
    publicClient.readContract({ address: d.contracts.engine, abi: ENGINE_ABI, functionName: "getViolations", args: [agentId] }),
  ]);
  return {
    attestations: (att as any[]).map((a) => ({ ...a, vType: Number(a.vType), credentialImpact: Number(a.credentialImpact) })),
    violations: (vio as any[]).map((v) => ({ ...v, severity: Number(v.severity) })),
  };
}

export type TrajectoryPoint = { stableBps: number; totalValueUsd: bigint; timestamp: number; actionType: number };

export async function readTrajectory(d: DemoConfig, agent: DemoAgent): Promise<{ points: TrajectoryPoint[]; policy: any }> {
  const [logs, policy] = await Promise.all([
    publicClient.getLogs({ address: agent.treasury, event: TREASURY_ACTION_EVENT, args: { agentId: BigInt(agent.id) }, fromBlock: 0n, toBlock: "latest" }),
    publicClient.readContract({ address: agent.treasury, abi: TREASURY_ABI, functionName: "getPolicy" }),
  ]);
  const points = (logs as any[]).map((l) => ({
    stableBps: Number(l.args.stableBps),
    totalValueUsd: l.args.totalValueUsd as bigint,
    timestamp: Number(l.args.timestamp),
    actionType: Number(l.args.actionType),
  }));
  return { points, policy };
}
