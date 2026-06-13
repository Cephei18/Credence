import { defineChain } from "viem";
import { baseSepolia } from "viem/chains";

export { baseSepolia };

// A local Hardhat chain definition so the same UI works against `hardhat node`.
export const hardhatLocal = defineChain({
  id: 31337,
  name: "Hardhat",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

export const PASSPORT_ADDRESS = (process.env.NEXT_PUBLIC_PASSPORT_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;
export const REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

export const LEVELS = ["Unverified", "Verified", "Trusted", "Autonomous"] as const;
export type LevelName = (typeof LEVELS)[number];

// Minimal ABI covering exactly what the demo UI calls / reads.
export const PASSPORT_ABI = [
  {
    type: "function",
    name: "registerPrincipal",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "registerAgent",
    stateMutability: "nonpayable",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "attemptAction",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "allowed", type: "bool" }],
  },
  {
    type: "function",
    name: "requestVerification",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "taskId", type: "bytes32" },
      { name: "parameters", type: "bytes" },
    ],
    outputs: [{ name: "requestId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "levelUp",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "issuePassport",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "label", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getCredential",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [
      { name: "level", type: "uint8" },
      { name: "verifiedCount", type: "uint64" },
      { name: "violations", type: "uint64" },
      { name: "live", type: "bool" },
      { name: "hasPassport", type: "bool" },
      { name: "spentInEpoch", type: "uint256" },
      { name: "spendLimit", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getRights",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "spendLimitPerEpoch", type: "uint256" },
          { name: "canDelegate", type: "bool" },
          { name: "treasuryAccess", type: "bool" },
          { name: "governanceAccess", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "principals",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "registered", type: "bool" },
      { name: "stake", type: "uint256" },
      { name: "agentCount", type: "uint256" },
      { name: "slashed", type: "uint256" },
    ],
  },
] as const;

export const REGISTRY_ABI = [
  {
    type: "function",
    name: "nameOf",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
] as const;
