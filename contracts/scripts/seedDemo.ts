import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Seeds the local chain with a full Credence demo: Agent Alpha (compliant) and
 * Agent Beta (breaching), each with a ManagedTreasury, a committed policy, a
 * behavior trajectory, and CRE-verified attestations. Writes web/public/demo.json
 * for the Explorer to read.
 *
 *   npm --workspace contracts run seed:demo   (against a running `hardhat node`)
 *
 * No protocol changes — this only EXERCISES the existing contracts.
 */
const FEED_DECIMALS = 8;
const usd = (n: bigint) => n * 10n ** 8n;
const USDC = (n: bigint) => n * 10n ** 6n;
const WETH = (n: bigint) => n * 10n ** 18n;

// Attestation/Credential type indices.
const T = { Research: 0, Treasury: 1, Prediction: 2, Execution: 3, Governance: 4, Risk: 5 };

// ABI constants the live frontend reuses for CRE verification.
const TREASURY_ACTION_TOPIC0 = ethers.id(
  "TreasuryAction(uint256,uint8,uint256,uint256,uint256,uint256,uint16,uint64)"
);
const GET_POLICY_SELECTOR = ethers.id("getPolicy()").slice(0, 10);

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0]; // owner / guardian / workflowSender
  const betaSponsor = signers[1];
  console.log(`Network: ${network.name}  Deployer: ${deployer.address}`);

  const parentNode = ethers.namehash("agentpassport.eth");

  // ---- core ----
  const passport = await (await ethers.getContractFactory("AgentPassport")).deploy(deployer.address);
  const registry = await (await ethers.getContractFactory("PassportNameRegistry")).deploy(deployer.address, parentNode);
  const engine = await (await ethers.getContractFactory("CredentialRegistry")).deploy(deployer.address);
  const cre = await (await ethers.getContractFactory("CREReceiver")).deploy(await passport.getAddress(), deployer.address);

  await (await passport.setNameRegistry(await registry.getAddress())).wait();
  await (await registry.setController(await passport.getAddress())).wait();
  await (await engine.setController(await passport.getAddress())).wait();
  await (await passport.setCredentialEngine(await engine.getAddress())).wait();
  await (await passport.setVerifier(await cre.getAddress())).wait();
  await (await cre.setWorkflowSender(deployer.address)).wait(); // operator bridges verdicts

  // ---- treasury pathway config ----
  await (await engine.setCredentialRequirement(T.Research, true, 2, false, 0n)).wait();
  await (await engine.setCredentialRequirement(T.Risk, true, 1, false, 0n)).wait();
  await (await engine.setCredentialRequirement(T.Treasury, true, 1, true, ethers.parseEther("0.2"))).wait();
  const bit = (i: number) => 1n << BigInt(i);
  await (await engine.setCredentialPrerequisites(T.Risk, bit(T.Research))).wait();
  await (await engine.setCredentialPrerequisites(T.Treasury, bit(T.Research) | bit(T.Risk))).wait();

  // ---- shared sandbox assets ----
  const stable = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
  const volatile = await (await ethers.getContractFactory("MockERC20")).deploy("Wrapped Ether", "WETH", 18);
  const feed = await (await ethers.getContractFactory("MockV3Aggregator")).deploy(FEED_DECIMALS, 2000n * 10n ** 8n);

  const Treasury = await ethers.getContractFactory("ManagedTreasury");

  async function deployTreasury(agentId: bigint, owner: any) {
    const t = await Treasury.connect(owner).deploy(
      agentId, owner.address, await stable.getAddress(), await volatile.getAddress(), await feed.getAddress(), owner.address
    );
    await t.waitForDeployment();
    // fund $100k: 80k USDC + 10 WETH
    await (await stable.mint(owner.address, USDC(80_000n))).wait();
    await (await volatile.mint(owner.address, WETH(10n))).wait();
    await (await stable.connect(owner).approve(await t.getAddress(), USDC(80_000n))).wait();
    await (await volatile.connect(owner).approve(await t.getAddress(), WETH(10n))).wait();
    await (await t.connect(owner).fund(USDC(80_000n), WETH(10n))).wait();
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await (await t.connect(owner).commitPolicy(8000, usd(98_000n), 9800, usd(100_000n), now, now + 7 * 24 * 3600)).wait();
    return t;
  }

  // Drive a verification through CREReceiver and submit the verdict as workflowSender.
  async function verify(agentId: bigint, attType: number, innerArgs: string[], success: boolean) {
    const taskId = ethers.keccak256(ethers.toUtf8Bytes(`seed:${agentId}:${attType}:${innerArgs.join("|")}`));
    const payload = ethers.AbiCoder.defaultAbiCoder().encode(["string[]"], [innerArgs]);
    const rc = await (await passport.requestTypedVerification(agentId, attType, taskId, payload, ethers.ZeroHash)).wait();
    let requestId: string | undefined;
    for (const log of rc!.logs) {
      try {
        const p = cre.interface.parseLog(log);
        if (p?.name === "WorkflowTrigger") requestId = p.args.requestId;
      } catch {}
    }
    await (await cre.fulfillFromWorkflow(requestId!, success)).wait();
  }

  function riskArgs(treasuryAddr: string) {
    return [treasuryAddr, TREASURY_ACTION_TOPIC0, GET_POLICY_SELECTOR];
  }
  const researchArgs = ["ETH-USD", "up", "1", "0"]; // trivially-true forecast (pipeline demo)

  // ---------- Agent Alpha (compliant) ----------
  await (await passport.registerPrincipal({ value: ethers.parseEther("0.5") })).wait();
  const rcA = await (await passport.registerAgent(deployer.address)).wait();
  const idA = parseAgentId(passport, rcA!);
  const treasuryA = await deployTreasury(idA, deployer);
  // compliant trajectory: stays >= 80% stable
  await (await treasuryA.rebalance(8500)).wait();
  await (await treasuryA.rebalance(8200)).wait();
  await (await treasuryA.rebalance(9000)).wait();
  // Research x2, then Risk x1 (Treasury left PENDING for the live demo)
  await verify(idA, T.Research, researchArgs, true);
  await verify(idA, T.Research, researchArgs, true);
  const worstA = await treasuryA.worstStableBps();
  await verify(idA, T.Risk, riskArgs(await treasuryA.getAddress()), worstA >= 8000n);
  console.log(`Alpha id=${idA} treasury=${await treasuryA.getAddress()} worstStableBps=${worstA}`);

  // ---------- Agent Beta (breaching) ----------
  await (await passport.connect(betaSponsor).registerPrincipal({ value: ethers.parseEther("0.5") })).wait();
  const rcB = await (await passport.connect(betaSponsor).registerAgent(betaSponsor.address)).wait();
  const idB = parseAgentId(passport, rcB!);
  const treasuryB = await deployTreasury(idB, betaSponsor);
  await (await treasuryB.connect(betaSponsor).rebalance(8500)).wait();
  await (await treasuryB.connect(betaSponsor).rebalance(3000)).wait(); // BREACH to 30% stable
  await verify(idB, T.Research, researchArgs, true);
  await verify(idB, T.Research, researchArgs, true);
  const worstB = await treasuryB.worstStableBps();
  await verify(idB, T.Risk, riskArgs(await treasuryB.getAddress()), worstB >= 8000n); // false → violation
  console.log(`Beta  id=${idB} treasury=${await treasuryB.getAddress()} worstStableBps=${worstB}`);

  // ---- write demo.json for the Explorer ----
  const out = {
    chainId: network.config.chainId ?? 31337,
    contracts: {
      passport: await passport.getAddress(),
      engine: await engine.getAddress(),
      registry: await registry.getAddress(),
      creReceiver: await cre.getAddress(),
      feed: await feed.getAddress(),
    },
    workflowSender: deployer.address,
    abi: { treasuryActionTopic0: TREASURY_ACTION_TOPIC0, getPolicySelector: GET_POLICY_SELECTOR },
    agents: [
      { id: idA.toString(), name: "Agent Alpha", flavor: "compliant", treasury: await treasuryA.getAddress(), operator: deployer.address, researchArgs },
      { id: idB.toString(), name: "Agent Beta", flavor: "breaching", treasury: await treasuryB.getAddress(), operator: betaSponsor.address, researchArgs },
    ],
  };
  const target = path.join(__dirname, "..", "..", "web", "public", "demo.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${target}`);
  console.log(JSON.stringify(out, null, 2));
}

function parseAgentId(passport: any, rc: any): bigint {
  for (const log of rc.logs) {
    try {
      const p = passport.interface.parseLog(log);
      if (p?.name === "AgentRegistered") return p.args.agentId;
    } catch {}
  }
  throw new Error("no AgentRegistered");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
