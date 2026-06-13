import { ethers, network } from "hardhat";

/**
 * Deploys the Agent Passport stack:
 *   1. AgentPassport      — constitution + enforcement chokepoint
 *   2. PassportNameRegistry — soulbound ENS-style passport names
 *   3. MockOutcomeVerifier  — demo verifier (swap for ChainlinkFunctionsVerifier in prod)
 * and wires them together.
 *
 * On a live network set DEPLOYER_PRIVATE_KEY. The deployer becomes the protocol
 * guardian (owner) and the mock verifier operator.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Network : ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);

  const parentNode = ethers.namehash("agentpassport.eth");

  const Passport = await ethers.getContractFactory("AgentPassport");
  const passport = await Passport.deploy(deployer.address);
  await passport.waitForDeployment();
  console.log(`AgentPassport       : ${await passport.getAddress()}`);

  const Registry = await ethers.getContractFactory("PassportNameRegistry");
  const registry = await Registry.deploy(deployer.address, parentNode);
  await registry.waitForDeployment();
  console.log(`PassportNameRegistry: ${await registry.getAddress()}`);

  const Verifier = await ethers.getContractFactory("MockOutcomeVerifier");
  const verifier = await Verifier.deploy(await passport.getAddress(), deployer.address);
  await verifier.waitForDeployment();
  console.log(`MockOutcomeVerifier : ${await verifier.getAddress()}`);

  const Engine = await ethers.getContractFactory("CredentialRegistry");
  const engine = await Engine.deploy(deployer.address);
  await engine.waitForDeployment();
  console.log(`CredentialRegistry  : ${await engine.getAddress()}`);

  await (await passport.setVerifier(await verifier.getAddress())).wait();
  await (await passport.setNameRegistry(await registry.getAddress())).wait();
  await (await registry.setController(await passport.getAddress())).wait();
  // Credential Engine: AgentPassport is its controller; passport points at it.
  await (await engine.setController(await passport.getAddress())).wait();
  await (await passport.setCredentialEngine(await engine.getAddress())).wait();

  // Typed-attestation eligibility (CredentialType indices: 0 Research, 1 Treasury,
  // 2 Prediction, 3 Execution, 4 Governance). A credential is earned only from a
  // threshold of its OWN attestation type; Treasury is the strictest tier.
  //                       (ctype, enabled, attestationsRequired, requireNoSevereViolations, minSponsorStake)
  await (await engine.setCredentialRequirement(0, true, 2, false, 0n)).wait();                        // Research
  await (await engine.setCredentialRequirement(1, true, 3, true, ethers.parseEther("0.2"))).wait();   // Treasury
  await (await engine.setCredentialRequirement(2, true, 1, false, 0n)).wait();                        // Prediction
  await (await engine.setCredentialRequirement(3, true, 2, false, ethers.parseEther("0.05"))).wait(); // Execution
  await (await engine.setCredentialRequirement(4, true, 2, false, 0n)).wait();                        // Governance
  await (await engine.setCredentialRequirement(5, true, 2, false, 0n)).wait();                        // Risk

  // Treasury pathway: Research → Risk → Treasury. Each credential requires the
  // prior one to be Active before it can be earned from attestations.
  const bit = (i: number) => 1n << BigInt(i);
  await (await engine.setCredentialPrerequisites(5, bit(0))).wait();            // Risk     ⇐ Research
  await (await engine.setCredentialPrerequisites(1, bit(0) | bit(5))).wait();   // Treasury ⇐ Research + Risk

  // Protocol attestation templates (source / success-criteria commitment / impact / descriptor).
  await (await engine.setAttestationTemplate(0, await verifier.getAddress(), ethers.id("research-v1"), 1, "Research: independently verified analysis output")).wait();
  await (await engine.setAttestationTemplate(5, await verifier.getAddress(), ethers.id("risk-v1"), 1, "Risk: drawdown / exposure bounds respected")).wait();
  await (await engine.setAttestationTemplate(1, await verifier.getAddress(), ethers.id("treasury-v1"), 1, "Treasury: simulated allocation matched realized outcome")).wait();
  console.log("Wired: typed requirements + treasury pathway (prerequisites) + attestation templates.");

  const out = {
    network: network.name,
    AgentPassport: await passport.getAddress(),
    PassportNameRegistry: await registry.getAddress(),
    MockOutcomeVerifier: await verifier.getAddress(),
    CredentialRegistry: await engine.getAddress(),
    parentNode,
  };
  console.log("\nDeployment summary:\n" + JSON.stringify(out, null, 2));
  console.log(
    "\nCopy these into web/.env.local as NEXT_PUBLIC_PASSPORT_ADDRESS etc."
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
