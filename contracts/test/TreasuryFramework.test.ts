import { expect } from "chai";
import { ethers } from "hardhat";

const PARENT_NODE = ethers.namehash("agentpassport.eth");
const A = { Research: 0, Treasury: 1, Prediction: 2, Execution: 3, Governance: 4, Risk: 5 };
const bit = (i: number) => 1n << BigInt(i);

function task(label: string) {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

async function deploy() {
  const [owner, founder, attacker, agentWallet] = await ethers.getSigners();

  const passport = await (await ethers.getContractFactory("AgentPassport")).deploy(owner.address);
  const nameRegistry = await (await ethers.getContractFactory("PassportNameRegistry")).deploy(owner.address, PARENT_NODE);
  const verifier = await (await ethers.getContractFactory("MockOutcomeVerifier")).deploy(await passport.getAddress(), owner.address);
  const engine = await (await ethers.getContractFactory("CredentialRegistry")).deploy(owner.address);

  await passport.connect(owner).setVerifier(await verifier.getAddress());
  await passport.connect(owner).setNameRegistry(await nameRegistry.getAddress());
  await nameRegistry.connect(owner).setController(await passport.getAddress());
  await engine.connect(owner).setController(await passport.getAddress());
  await passport.connect(owner).setCredentialEngine(await engine.getAddress());

  // Treasury pathway config (mirrors deploy.ts).
  await engine.connect(owner).setCredentialRequirement(A.Research, true, 2, false, 0n);
  await engine.connect(owner).setCredentialRequirement(A.Risk, true, 2, false, 0n);
  await engine.connect(owner).setCredentialRequirement(A.Treasury, true, 2, true, ethers.parseEther("0.2"));
  await engine.connect(owner).setCredentialPrerequisites(A.Risk, bit(A.Research));
  await engine.connect(owner).setCredentialPrerequisites(A.Treasury, bit(A.Research) | bit(A.Risk));

  return { owner, founder, attacker, agentWallet, passport, nameRegistry, verifier, engine };
}

async function typedVerify(passport: any, verifier: any, owner: any, agentId: number, attType: number, label: string, success = true) {
  const tx = await passport.requestTypedVerification(agentId, attType, task(label), "0x", ethers.ZeroHash);
  const rc = await tx.wait();
  let requestId: string | undefined;
  for (const log of rc!.logs) {
    try {
      const parsed = verifier.interface.parseLog(log);
      if (parsed?.name === "VerificationRequested") requestId = parsed.args.requestId;
    } catch {}
  }
  await verifier.connect(owner).resolve(requestId!, success);
}

async function setup(passport: any, founder: any, agentWallet: any, stake = "0.2") {
  await passport.connect(founder).registerPrincipal({ value: ethers.parseEther(stake) });
  await passport.connect(founder).registerAgent(agentWallet.address);
}

// Walk the full Research → Risk → Treasury attestation chain.
async function walkPathway(passport: any, verifier: any, owner: any, id: number) {
  await typedVerify(passport, verifier, owner, id, A.Research, "res-1");
  await typedVerify(passport, verifier, owner, id, A.Research, "res-2"); // Research active (2)
  await typedVerify(passport, verifier, owner, id, A.Risk, "risk-1");
  await typedVerify(passport, verifier, owner, id, A.Risk, "risk-2");     // Risk active (2, prereq Research ok)
  await typedVerify(passport, verifier, owner, id, A.Treasury, "tre-1");
  await typedVerify(passport, verifier, owner, id, A.Treasury, "tre-2");  // Treasury active (2, prereqs ok)
}

describe("TreasuryFramework", () => {
  it("issues the Treasury credential only after the full Research → Risk → Treasury chain", async () => {
    const { passport, engine, verifier, owner, founder, agentWallet } = await deploy();
    await setup(passport, founder, agentWallet);

    await walkPathway(passport, verifier, owner, 1);
    expect(await engine.isCredentialActive(1, A.Research)).to.equal(true);
    expect(await engine.isCredentialActive(1, A.Risk)).to.equal(true);
    expect(await engine.isCredentialActive(1, A.Treasury)).to.equal(true);
  });

  it("enforces prerequisites: Treasury attestations alone cannot skip the chain", async () => {
    const { passport, engine, verifier, owner, founder, agentWallet } = await deploy();
    await setup(passport, founder, agentWallet);

    // Treasury attestations without Research/Risk → not issued (invalid progression).
    await typedVerify(passport, verifier, owner, 1, A.Treasury, "t1");
    await typedVerify(passport, verifier, owner, 1, A.Treasury, "t2");
    expect(await engine.isCredentialActive(1, A.Treasury)).to.equal(false);

    // Risk before Research also blocked.
    await typedVerify(passport, verifier, owner, 1, A.Risk, "rk1");
    await typedVerify(passport, verifier, owner, 1, A.Risk, "rk2");
    expect(await engine.isCredentialActive(1, A.Risk)).to.equal(false);
  });

  it("treasury rights expand along the tiers", async () => {
    const { passport, engine, verifier, owner, founder, agentWallet } = await deploy();
    await setup(passport, founder, agentWallet);

    // Tier 0: nothing.
    expect(await passport.treasuryTier(1)).to.equal(0);
    await expect(passport.attemptTreasuryAction(1, 0)).to.be.revertedWithCustomError(passport, "NoTreasuryAuthority");

    // Research + Risk → Tier 1 (simulation only).
    await typedVerify(passport, verifier, owner, 1, A.Research, "r1");
    await typedVerify(passport, verifier, owner, 1, A.Research, "r2");
    await typedVerify(passport, verifier, owner, 1, A.Risk, "rk1");
    await typedVerify(passport, verifier, owner, 1, A.Risk, "rk2");
    expect(await passport.treasuryTier(1)).to.equal(1);
    await expect(passport.attemptTreasuryAction(1, 0)).to.emit(passport, "TreasuryActionAttempted"); // simulation ok
    await expect(passport.attemptTreasuryAction(1, ethers.parseEther("0.1"))).to.be.revertedWithCustomError(passport, "TreasuryTierTooLow");

    // + Treasury → full chain → Tier 3 (higher-value execution).
    await typedVerify(passport, verifier, owner, 1, A.Treasury, "t1");
    await typedVerify(passport, verifier, owner, 1, A.Treasury, "t2");
    expect(await passport.treasuryTier(1)).to.equal(3);
    await expect(passport.attemptTreasuryAction(1, ethers.parseEther("5"))).to.emit(passport, "TreasuryActionAttempted");
    await expect(passport.attemptTreasuryAction(1, ethers.parseEther("50"))).to.be.revertedWithCustomError(passport, "TreasuryTierTooLow");
  });

  it("level-bridge Treasury (Autonomous) grants only Tier 2, not Tier 3", async () => {
    const { passport, engine, verifier, owner, founder, agentWallet } = await deploy();
    await setup(passport, founder, agentWallet);

    // Climb to Autonomous via legacy verifications + levelUps (level bridge grants Treasury cred).
    for (let i = 0; i < 6; i++) await typedVerify(passport, verifier, owner, 1, A.Prediction, `p${i}`);
    await passport.levelUp(1);
    await passport.levelUp(1);
    await passport.levelUp(1);

    expect(await engine.isCredentialActive(1, A.Treasury)).to.equal(true); // via bridge
    expect(await engine.isCredentialActive(1, A.Risk)).to.equal(false);    // never earned
    expect(await passport.treasuryTier(1)).to.equal(2); // capped at small execution
    await expect(passport.attemptTreasuryAction(1, ethers.parseEther("1"))).to.emit(passport, "TreasuryActionAttempted");
    await expect(passport.attemptTreasuryAction(1, ethers.parseEther("5"))).to.be.revertedWithCustomError(passport, "TreasuryTierTooLow");
  });

  it("treasury rights are revoked when a severe violation revokes the credential", async () => {
    const { passport, engine, verifier, owner, founder, agentWallet } = await deploy();
    await setup(passport, founder, agentWallet);
    await walkPathway(passport, verifier, owner, 1);
    expect(await passport.treasuryTier(1)).to.equal(3);

    // Critical violation revokes all credentials → treasury authority gone.
    await engine.connect(owner).reportViolation(1, 3, "treasury exploit", owner.address);
    expect(await passport.treasuryTier(1)).to.equal(0);
    await expect(passport.attemptTreasuryAction(1, 0)).to.be.revertedWithCustomError(passport, "NoTreasuryAuthority");
  });

  it("Treasury credential is gated on minimum sponsor stake even with the full chain", async () => {
    const { passport, engine, verifier, owner, founder, agentWallet } = await deploy();
    await setup(passport, founder, agentWallet, "0.05"); // below Treasury min 0.2

    await typedVerify(passport, verifier, owner, 1, A.Research, "r1");
    await typedVerify(passport, verifier, owner, 1, A.Research, "r2");
    await typedVerify(passport, verifier, owner, 1, A.Risk, "rk1");
    await typedVerify(passport, verifier, owner, 1, A.Risk, "rk2");
    await typedVerify(passport, verifier, owner, 1, A.Treasury, "t1");
    await typedVerify(passport, verifier, owner, 1, A.Treasury, "t2");
    expect(await engine.isCredentialActive(1, A.Treasury)).to.equal(false); // stake too low

    await passport.connect(founder).addStake({ value: ethers.parseEther("0.2") });
    await typedVerify(passport, verifier, owner, 1, A.Treasury, "t3");
    expect(await engine.isCredentialActive(1, A.Treasury)).to.equal(true);
  });

  it("registers queryable attestation templates", async () => {
    const { engine, owner, verifier } = await deploy();
    await engine.connect(owner).setAttestationTemplate(
      A.Treasury,
      await verifier.getAddress(),
      ethers.id("treasury-v1"),
      1,
      "Treasury attestation"
    );
    const t = await engine.getAttestationTemplate(A.Treasury);
    expect(t.defined).to.equal(true);
    expect(t.verifierSource).to.equal(await verifier.getAddress());
    expect(t.credentialImpact).to.equal(1n);
  });
});
