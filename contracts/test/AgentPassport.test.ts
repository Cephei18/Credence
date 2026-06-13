import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

// Fully-qualified parent: namehash("agentpassport.eth"). Value is irrelevant to
// logic (we only need a stable parent), so any nonzero node works for tests.
const PARENT_NODE = ethers.namehash("agentpassport.eth");
const TASK = ethers.keccak256(ethers.toUtf8Bytes("predict-eth-up-24h"));

async function deploy() {
  const [owner, founder, attacker, agentWallet] = await ethers.getSigners();

  const Passport = await ethers.getContractFactory("AgentPassport");
  const passport = await Passport.deploy(owner.address);

  const Registry = await ethers.getContractFactory("PassportNameRegistry");
  const registry = await Registry.deploy(owner.address, PARENT_NODE);

  const Verifier = await ethers.getContractFactory("MockOutcomeVerifier");
  const verifier = await Verifier.deploy(await passport.getAddress(), owner.address);

  await passport.connect(owner).setVerifier(await verifier.getAddress());
  await passport.connect(owner).setNameRegistry(await registry.getAddress());
  await registry.connect(owner).setController(await passport.getAddress());

  return { owner, founder, attacker, agentWallet, passport, registry, verifier };
}

// Drive one verified-success outcome for an agent through the mock verifier.
async function verifySuccess(passport: any, verifier: any, owner: any, agentId: number) {
  const tx = await passport.requestVerification(agentId, TASK, "0x");
  const rc = await tx.wait();
  // Pull requestId from the verifier's VerificationRequested event.
  const iface = verifier.interface;
  let requestId: string | undefined;
  for (const log of rc!.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "VerificationRequested") requestId = parsed.args.requestId;
    } catch {}
  }
  expect(requestId, "no requestId emitted").to.not.be.undefined;
  await verifier.connect(owner).resolve(requestId, true);
}

describe("AgentPassport", () => {
  it("registers a principal only with sufficient stake", async () => {
    const { passport, attacker } = await deploy();
    await expect(
      passport.connect(attacker).registerPrincipal({ value: ethers.parseEther("0.0001") })
    ).to.be.revertedWithCustomError(passport, "InsufficientStake");

    await expect(
      passport.connect(attacker).registerPrincipal({ value: ethers.parseEther("0.001") })
    ).to.emit(passport, "PrincipalRegistered");
  });

  it("creates agents at Level 0 with a tiny envelope and no delegation/treasury", async () => {
    const { passport, founder, agentWallet } = await deploy();
    await passport.connect(founder).registerPrincipal({ value: ethers.parseEther("0.2") });
    await passport.connect(founder).registerAgent(agentWallet.address);

    const rights = await passport.getRights(1);
    expect(rights.spendLimitPerEpoch).to.equal(ethers.parseEther("0.0005"));
    expect(rights.canDelegate).to.equal(false);
    expect(rights.treasuryAccess).to.equal(false);
  });

  it("blocks an action over the Level 0 spend limit (enforcement chokepoint)", async () => {
    const { passport, founder, agentWallet } = await deploy();
    await passport.connect(founder).registerPrincipal({ value: ethers.parseEther("0.2") });
    await passport.connect(founder).registerAgent(agentWallet.address);

    // Within limit: allowed.
    await expect(passport.attemptAction(1, ethers.parseEther("0.0004"))).to.emit(
      passport,
      "ActionAttempted"
    );
    // Over the remaining limit: reverts.
    await expect(
      passport.attemptAction(1, ethers.parseEther("0.0002"))
    ).to.be.revertedWithCustomError(passport, "InsufficientStake");
  });

  it("only the registered verifier can fulfill outcomes (no self-reporting)", async () => {
    const { passport, founder, attacker, agentWallet } = await deploy();
    await passport.connect(founder).registerPrincipal({ value: ethers.parseEther("0.2") });
    await passport.connect(founder).registerAgent(agentWallet.address);

    await expect(
      passport.connect(attacker).fulfillVerification(ethers.ZeroHash, 1, true)
    ).to.be.revertedWithCustomError(passport, "NotVerifier");
  });

  it("runs the full magical flow: verify -> levelUp -> passport -> unblocked action", async () => {
    const { passport, registry, verifier, owner, founder, agentWallet } = await deploy();
    await passport.connect(founder).registerPrincipal({ value: ethers.parseEther("0.2") });
    await passport.connect(founder).registerAgent(agentWallet.address);

    // Level 0 -> 1 needs 1 verified outcome.
    await verifySuccess(passport, verifier, owner, 1);
    await expect(passport.levelUp(1)).to.emit(passport, "LeveledUp");

    let cred = await passport.getCredential(1);
    expect(cred.level).to.equal(1); // Verified

    // Eligible for a passport at Level 1.
    await expect(passport.issuePassport(1, "verified-research"))
      .to.emit(passport, "PassportIssued");
    expect(await registry.nameOf(1)).to.equal("verified-research.agentpassport.eth");

    // Now a previously-blocked 0.01 ETH action is within the Level 1 envelope.
    await expect(passport.attemptAction(1, ethers.parseEther("0.01"))).to.emit(
      passport,
      "ActionAttempted"
    );

    // Climb to Trusted (needs 3) then Autonomous (needs 6).
    await verifySuccess(passport, verifier, owner, 1); // 2
    await verifySuccess(passport, verifier, owner, 1); // 3
    await expect(passport.levelUp(1)).to.emit(passport, "LeveledUp");
    cred = await passport.getCredential(1);
    expect(cred.level).to.equal(2); // Trusted

    const r2 = await passport.getRights(1);
    expect(r2.canDelegate).to.equal(true);
    expect(r2.governanceAccess).to.equal(true);
    expect(r2.treasuryAccess).to.equal(false);
  });

  it("refuses level-up without enough verified outcomes", async () => {
    const { passport, verifier, owner, founder, agentWallet } = await deploy();
    await passport.connect(founder).registerPrincipal({ value: ethers.parseEther("0.2") });
    await passport.connect(founder).registerAgent(agentWallet.address);

    await verifySuccess(passport, verifier, owner, 1); // ->1 ok
    await passport.levelUp(1);
    // To reach Trusted we need 3 verified; only have 1.
    await expect(passport.levelUp(1)).to.be.revertedWithCustomError(passport, "NothingToLevel");
  });

  it("enforces stake floor: Autonomous requires more stake than a thin principal holds", async () => {
    const { passport, verifier, owner, founder, agentWallet } = await deploy();
    // Register with only enough for Verified, then try to climb to Autonomous.
    await passport.connect(founder).registerPrincipal({ value: ethers.parseEther("0.01") });
    await passport.connect(founder).registerAgent(agentWallet.address);

    for (let i = 0; i < 6; i++) await verifySuccess(passport, verifier, owner, 1);
    await passport.levelUp(1); // ->1 (needs 0.01) ok
    await expect(passport.levelUp(1)).to.be.revertedWithCustomError(
      passport,
      "InsufficientStake"
    ); // ->2 needs 0.05, only 0.01 staked
  });

  it("decays credentials: a stale agent collapses to the Level 0 envelope", async () => {
    const { passport, verifier, owner, founder, agentWallet } = await deploy();
    await passport.connect(founder).registerPrincipal({ value: ethers.parseEther("0.2") });
    await passport.connect(founder).registerAgent(agentWallet.address);
    await verifySuccess(passport, verifier, owner, 1);
    await passport.levelUp(1);

    expect(await passport.isCredentialLive(1)).to.equal(true);

    // Fast-forward past the 30-day TTL.
    await time.increase(31 * 24 * 60 * 60);
    expect(await passport.isCredentialLive(1)).to.equal(false);

    const rights = await passport.getRights(1);
    expect(rights.spendLimitPerEpoch).to.equal(ethers.parseEther("0.0005")); // back to L0
  });

  it("slashes stake and downgrades on a failed/dishonest outcome", async () => {
    const { passport, verifier, owner, founder, agentWallet } = await deploy();
    await passport.connect(founder).registerPrincipal({ value: ethers.parseEther("0.2") });
    await passport.connect(founder).registerAgent(agentWallet.address);

    await verifySuccess(passport, verifier, owner, 1);
    await passport.levelUp(1); // Level 1

    const before = (await passport.principals(founder.address)).stake;

    // Drive a FAILED outcome.
    const tx = await passport.requestVerification(1, TASK, "0x");
    const rc = await tx.wait();
    let requestId: string | undefined;
    for (const log of rc!.logs) {
      try {
        const parsed = verifier.interface.parseLog(log);
        if (parsed?.name === "VerificationRequested") requestId = parsed.args.requestId;
      } catch {}
    }
    await verifier.connect(owner).resolve(requestId!, false);

    const after = (await passport.principals(founder.address)).stake;
    expect(after).to.be.lessThan(before); // slashed
    const cred = await passport.getCredential(1);
    expect(cred.level).to.equal(0); // downgraded from Verified
    expect(cred.violations).to.equal(1);
  });

  it("prevents withdrawing stake below the floor required by active agents", async () => {
    const { passport, verifier, owner, founder, agentWallet } = await deploy();
    await passport.connect(founder).registerPrincipal({ value: ethers.parseEther("0.06") });
    await passport.connect(founder).registerAgent(agentWallet.address);
    for (let i = 0; i < 3; i++) await verifySuccess(passport, verifier, owner, 1);
    await passport.levelUp(1); // ->1
    await passport.levelUp(1); // ->2 Trusted (floor 0.05)

    // Can't pull below 0.05.
    await expect(
      passport.connect(founder).withdrawStake(ethers.parseEther("0.02"))
    ).to.be.revertedWithCustomError(passport, "StakeLocked");
  });

  it("guardian can pause an agent, blocking all actions", async () => {
    const { passport, owner, founder, agentWallet } = await deploy();
    await passport.connect(founder).registerPrincipal({ value: ethers.parseEther("0.2") });
    await passport.connect(founder).registerAgent(agentWallet.address);
    await passport.connect(owner).pauseAgent(1, true);
    await expect(
      passport.attemptAction(1, ethers.parseEther("0.0001"))
    ).to.be.revertedWithCustomError(passport, "AgentIsPaused");
  });

  it("passport names are unique and soulbound (no transfer surface)", async () => {
    const { passport, registry, verifier, owner, founder, agentWallet } = await deploy();
    await passport.connect(founder).registerPrincipal({ value: ethers.parseEther("0.2") });
    await passport.connect(founder).registerAgent(agentWallet.address);
    await passport.connect(founder).registerAgent(agentWallet.address);
    await verifySuccess(passport, verifier, owner, 1);
    await verifySuccess(passport, verifier, owner, 2);
    await passport.levelUp(1);
    await passport.levelUp(2);

    await passport.issuePassport(1, "verified-research");
    await expect(passport.issuePassport(2, "verified-research")).to.be.revertedWithCustomError(
      registry,
      "LabelTaken"
    );
    // No transfer function exists on the registry — soulbound by construction.
    expect((registry as any).transferFrom).to.equal(undefined);
  });
});
