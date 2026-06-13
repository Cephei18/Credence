// Throwaway: validate the Explorer's viem reads against the seeded chain.
import { createPublicClient, http, parseAbi } from "viem";
import { readFileSync } from "fs";

const d = JSON.parse(readFileSync(new URL("../public/demo.json", import.meta.url)));
const client = createPublicClient({ transport: http("http://127.0.0.1:8545") });

const ENGINE = parseAbi([
  "function listCredentials(uint256) view returns (uint8[6],uint64[6],uint64[6])",
  "function activeCredentialMask(uint256) view returns (uint256)",
  "function getVerificationHistory(uint256) view returns ((uint8 vType,bool outcome,int8 credentialImpact,uint64 timestamp,address verifierSource,bytes32 taskId,bytes32 metadata)[])",
]);
const PASS = parseAbi(["function treasuryTier(uint256) view returns (uint8)"]);
const TRE = parseAbi(["function getPolicy() view returns ((uint16 minStableBps,uint256 capitalFloorUsd,uint16 minEndBps,uint256 startValueUsd,uint64 windowStart,uint64 windowEnd,uint64 startBlock))"]);
const EVT = parseAbi(["event TreasuryAction(uint256 indexed agentId,uint8 actionType,uint256 stableBalance,uint256 volatileBalance,uint256 ethUsdPrice,uint256 totalValueUsd,uint16 stableBps,uint64 timestamp)"])[0];
const NAMES = ["None", "Pending", "Active", "Suspended", "Revoked", "Expired"];

for (const a of d.agents) {
  const id = BigInt(a.id);
  const [states] = await client.readContract({ address: d.contracts.engine, abi: ENGINE, functionName: "listCredentials", args: [id] });
  const tier = await client.readContract({ address: d.contracts.passport, abi: PASS, functionName: "treasuryTier", args: [id] });
  const hist = await client.readContract({ address: d.contracts.engine, abi: ENGINE, functionName: "getVerificationHistory", args: [id] });
  const policy = await client.readContract({ address: a.treasury, abi: TRE, functionName: "getPolicy" });
  const logs = await client.getLogs({ address: a.treasury, event: EVT, args: { agentId: id }, fromBlock: 0n, toBlock: "latest" });
  console.log(`\n${a.name} (${a.flavor})  tier=${tier}`);
  console.log(`  credentials: Research=${NAMES[states[0]]} Risk=${NAMES[states[5]]} Treasury=${NAMES[states[1]]}`);
  console.log(`  attestations=${hist.length}  trajectoryPoints=${logs.length}  minStableFloor=${policy.minStableBps}bps`);
  console.log(`  stableBps trajectory: [${logs.map((l) => Number(l.args.stableBps)).join(", ")}]`);
}
