import { ethers, network } from "hardhat";

/**
 * Commit 5 smoke test — one REAL DON-powered Research verification on Base Sepolia.
 *
 *   npm --workspace contracts run smoke:chainlink
 *
 * Prereqs: deploy:baseSepolia done, deployChainlink done, the verifier added as a
 * subscription consumer, and the subscription funded with LINK.
 *
 * Flow proven: requestTypedVerification(Research) -> DON runs source.js ->
 * fulfillVerification -> typed attestation recorded in the CredentialRegistry.
 */
const RESEARCH = 0; // AttestationType.Research

function need(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env ${key}`);
  return v;
}

async function main() {
  const [signer] = await ethers.getSigners();
  const passport = await ethers.getContractAt("AgentPassport", need("PASSPORT_ADDRESS"));
  console.log(`Network: ${network.name}  Signer: ${signer.address}`);

  // Ensure the signer is a registered principal.
  const principal = await passport.principals(signer.address);
  if (!principal.registered) {
    await (await passport.registerPrincipal({ value: ethers.parseEther("0.001") })).wait();
    console.log("Registered principal (0.001 ETH stake).");
  }

  // Create a fresh agent.
  const rc = await (await passport.registerAgent(signer.address)).wait();
  let agentId: bigint | undefined;
  for (const log of rc!.logs) {
    try {
      const p = passport.interface.parseLog(log);
      if (p?.name === "AgentRegistered") agentId = p.args.agentId;
    } catch {}
  }
  if (agentId === undefined) throw new Error("no AgentRegistered event");
  console.log(`Agent id: ${agentId}`);

  // Research forecast: "ETH-USD up >= $1 by deadline 0" (trivially true now) so
  // the smoke test asserts the PIPELINE, not market direction.
  const innerArgs = ["ETH-USD", "up", "1", "0"];
  const payload = ethers.AbiCoder.defaultAbiCoder().encode(["string[]"], [innerArgs]);
  const taskId = ethers.keccak256(ethers.toUtf8Bytes(`research:${agentId}:${innerArgs.join("|")}`));

  const reqTx = await passport.requestTypedVerification(agentId, RESEARCH, taskId, payload, ethers.ZeroHash);
  const reqRc = await reqTx.wait();
  console.log(`requestTypedVerification tx: ${reqTx.hash}`);
  let requestId: string | undefined;
  for (const log of reqRc!.logs) {
    try {
      const p = passport.interface.parseLog(log);
      if (p?.name === "VerificationRequested") requestId = p.args.requestId;
    } catch {}
  }
  console.log(`Chainlink requestId: ${requestId}`);

  // Poll for the DON callback (typically 1-3 min on Base Sepolia).
  const engine = await ethers.getContractAt("CredentialRegistry", await passport.credentialEngine());
  console.log("Waiting for DON callback (polling verification history)...");
  const start = Date.now();
  while (Date.now() - start < 5 * 60 * 1000) {
    const count = await engine.verificationCount(agentId);
    if (count > 0n) {
      const att = await engine.getVerification(agentId, 0);
      console.log(`\nATTESTATION RECORDED ✓`);
      console.log(`  vType=${att.vType} outcome=${att.outcome} source=${att.verifierSource}`);
      console.log(`  verificationCount=${count}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 10_000));
    process.stdout.write(".");
  }
  throw new Error("Timed out waiting for DON callback. Check subscription funding/consumer + Functions logs.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
