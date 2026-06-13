import { ethers } from "hardhat";

/**
 * DEMO helper: resolve the most recent pending verification request for an
 * agent through the MockOutcomeVerifier (simulates the Chainlink DON callback).
 *
 * Usage:
 *   npx hardhat run scripts/resolve.ts --network localhost   # resolves agent 1 = success
 *   AGENT_ID=2 SUCCESS=false npx hardhat run scripts/resolve.ts --network localhost
 *
 * Requires VERIFIER_ADDRESS (the deployed MockOutcomeVerifier) in env, and the
 * task id used when requesting (defaults to the demo task).
 */
async function main() {
  const verifierAddr = process.env.VERIFIER_ADDRESS;
  if (!verifierAddr) throw new Error("set VERIFIER_ADDRESS");
  const agentId = BigInt(process.env.AGENT_ID ?? "1");
  const success = (process.env.SUCCESS ?? "true") === "true";
  const taskId = ethers.keccak256(
    ethers.toUtf8Bytes(process.env.TASK ?? "predict-eth-up-24h")
  );

  const verifier = await ethers.getContractAt("MockOutcomeVerifier", verifierAddr);

  // Find the open requestId for this agent by replaying VerificationRequested logs.
  const filter = verifier.filters.VerificationRequested();
  const logs = await verifier.queryFilter(filter, 0, "latest");
  const match = [...logs]
    .reverse()
    .find((l) => (l.args?.agentId as bigint) === agentId && (l.args?.taskId as string) === taskId);
  if (!match) throw new Error(`no pending request for agent ${agentId}`);

  const requestId = match.args!.requestId as string;
  const tx = await verifier.resolve(requestId, success);
  await tx.wait();
  console.log(
    `Resolved request ${requestId} for agent ${agentId}: success=${success}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
