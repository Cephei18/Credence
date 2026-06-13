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
  console.log("Wired: verifier + name registry + credential engine + controllers set.");

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
