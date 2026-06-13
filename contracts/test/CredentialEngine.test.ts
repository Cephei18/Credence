import { expect } from "chai";
import { ethers } from "hardhat";

const PARENT_NODE = ethers.namehash("agentpassport.eth");
const TASK = ethers.keccak256(ethers.toUtf8Bytes("predict-eth-up-24h"));

// CredentialType indices (must match contracts)
const T = { Research: 0, Treasury: 1, Prediction: 2, Execution: 3, Governance: 4 };
// CredentialState indices
const S = { None: 0, Pending: 1, Active: 2, Suspended: 3, Revoked: 4, Expired: 5 };

async function deploy() {
  const [owner, founder, attacker, agentWallet] = await ethers.getSigners();

  const Passport = await ethers.getContractFactory("AgentPassport");
  const passport = await Passport.deploy(owner.address);

  const Registry = await ethers.getContractFactory("PassportNameRegistry");
  const nameRegistry = await Registry.deploy(owner.address, PARENT_NODE);

  const Verifier = await ethers.getContractFactory("MockOutcomeVerifier");
  const verifier = await Verifier.deploy(await passport.getAddress(), owner.address);

  const Engine = await ethers.getContractFactory("CredentialRegistry");
  const engine = await Engine.deploy(owner.address);

  await passport.connect(owner).setVerifier(await verifier.getAddress());
  await passport.connect(owner).setNameRegistry(await nameRegistry.getAddress());
  await nameRegistry.connect(owner).setController(await passport.getAddress());
  await engine.connect(owner).setController(await passport.getAddress());
  await passport.connect(owner).setCredentialEngine(await engine.getAddress());

  return { owner, founder, attacker, agentWallet, passport, nameRegistry, verifier, engine };
}

async function verify(passport: any, verifier: any, owner: any, agentId: number, success = true) {
  const tx = await passport.requestVerification(agentId, TASK, "0x");
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

describe("CredentialEngine", () => {
  it("leveling up grants and activates the level's credentials (Level → Credential bridge)", async () => {
    const { passport, engine, verifier, owner, founder, agentWallet } = await deploy();
    await setup(passport, founder, agentWallet);

    // Level 0: no credentials active.
    expect(await engine.activeCredentialMask(1)).to.equal(0n);

    await verify(passport, verifier, owner, 1);
    await expect(passport.levelUp(1))
      .to.emit(engine, "CredentialActivated")
      .and.to.emit(passport, "RightsExpanded");

    // Level 1 (Verified) grants Prediction.
    expect(await engine.isCredentialActive(1, T.Prediction)).to.equal(true);
    expect(await engine.isCredentialActive(1, T.Execution)).to.equal(false);
    expect(await engine.activeCredentialMask(1)).to.equal(1n << BigInt(T.Prediction));
  });

  it("derives rights from active credentials (Credential → Rights)", async () => {
    const { passport, engine, verifier, owner, founder, agentWallet } = await deploy();
    await setup(passport, founder, agentWallet);

    // Climb to Trusted (Level 2): Prediction + Execution + Governance.
    for (let i = 0; i < 3; i++) await verify(passport, verifier, owner, 1);
    await passport.levelUp(1);
    await passport.levelUp(1);

    const r = await engine.resolveRights(1);
    expect(r.canDelegate).to.equal(true);
    expect(r.governanceAccess).to.equal(true);
    expect(r.treasuryAccess).to.equal(false);
    expect(r.spendTier).to.equal(2n);

    // Autonomous (Level 3): + Treasury.
    for (let i = 0; i < 3; i++) await verify(passport, verifier, owner, 1);
    await passport.levelUp(1);
    const r3 = await engine.resolveRights(1);
    expect(r3.treasuryAccess).to.equal(true);
    expect(r3.spendTier).to.equal(3n);
  });

  it("records an immutable verification history with outcome, source and impact", async () => {
    const { passport, engine, verifier, owner, founder, agentWallet } = await deploy();
    await setup(passport, founder, agentWallet);

    await verify(passport, verifier, owner, 1, true);
    await verify(passport, verifier, owner, 1, true);

    expect(await engine.verificationCount(1)).to.equal(2n);
    const a0 = await engine.getVerification(1, 0);
    expect(a0.outcome).to.equal(true);
    expect(a0.credentialImpact).to.equal(1n);
    expect(a0.verifierSource).to.equal(await verifier.getAddress());
    expect(a0.vType).to.equal(2n); // Prediction default
  });

  it("a failed verification raises a major violation that suspends active credentials", async () => {
    const { passport, engine, verifier, owner, founder, agentWallet } = await deploy();
    await setup(passport, founder, agentWallet);

    await verify(passport, verifier, owner, 1); // ->1 verified
    await passport.levelUp(1);
    expect(await engine.isCredentialActive(1, T.Prediction)).to.equal(true);

    await verify(passport, verifier, owner, 1, false); // failure

    expect(await engine.violationCount(1)).to.equal(1n);
    const v = (await engine.getViolations(1))[0];
    expect(v.severity).to.equal(2n);
    // Active Prediction credential is now suspended (responds to violation).
    expect(await engine.credentialState(1, T.Prediction)).to.equal(BigInt(S.Suspended));
    expect(await engine.isCredentialActive(1, T.Prediction)).to.equal(false);
  });

  it("guardian revokeRights cascades to revoke all engine credentials", async () => {
    const { passport, engine, verifier, owner, founder, agentWallet } = await deploy();
    await setup(passport, founder, agentWallet);
    for (let i = 0; i < 3; i++) await verify(passport, verifier, owner, 1);
    await passport.levelUp(1);
    await passport.levelUp(1); // Trusted: 3 active credentials

    await passport.connect(owner).revokeRights(1, 0); // back to Unverified
    expect(await engine.credentialState(1, T.Prediction)).to.equal(BigInt(S.Revoked));
    expect(await engine.credentialState(1, T.Execution)).to.equal(BigInt(S.Revoked));
    expect(await engine.activeCredentialMask(1)).to.equal(0n);
  });

  it("explicit state machine: invalid transitions revert", async () => {
    const { engine, owner } = await deploy();
    // owner is also authorized (guardian). Activating a None credential is invalid.
    await expect(
      engine.connect(owner).activateCredential(99, T.Research)
    ).to.be.revertedWithCustomError(engine, "InvalidTransition");

    // issue (None->Pending) then suspend (only Active->Suspended) is invalid from Pending.
    await engine.connect(owner).issueCredential(99, T.Research, 0);
    await expect(
      engine.connect(owner).suspendCredential(99, T.Research, "x")
    ).to.be.revertedWithCustomError(engine, "InvalidTransition");

    // Pending -> Active is valid; then Active -> Suspended valid.
    await engine.connect(owner).activateCredential(99, T.Research);
    await engine.connect(owner).suspendCredential(99, T.Research, "x");
    expect(await engine.credentialState(99, T.Research)).to.equal(BigInt(S.Suspended));
  });

  it("unauthorized callers cannot mutate credential state", async () => {
    const { engine, attacker } = await deploy();
    await expect(
      engine.connect(attacker).issueCredential(1, T.Treasury, 0)
    ).to.be.revertedWithCustomError(engine, "NotAuthorized");
    await expect(
      engine.connect(attacker).reportViolation(1, 3, "rug", attacker.address)
    ).to.be.revertedWithCustomError(engine, "NotAuthorized");
    await expect(
      engine.connect(attacker).syncLevelCredentials(1, 3)
    ).to.be.revertedWithCustomError(engine, "NotAuthorized");
  });

  it("expiry: a credential past its window is treated as Expired and can be poked", async () => {
    const { engine, owner } = await deploy();
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const expiresAt = now + 100;
    await engine.connect(owner).issueCredential(7, T.Governance, expiresAt);
    await engine.connect(owner).activateCredential(7, T.Governance);
    expect(await engine.isCredentialActive(7, T.Governance)).to.equal(true);

    await ethers.provider.send("evm_increaseTime", [200]);
    await ethers.provider.send("evm_mine", []);

    // View reflects expiry without a write.
    expect(await engine.credentialState(7, T.Governance)).to.equal(BigInt(S.Expired));
    expect(await engine.isCredentialActive(7, T.Governance)).to.equal(false);

    // Permissionless poke finalizes it.
    await expect(engine.expireCredential(7, T.Governance)).to.emit(engine, "CredentialExpired");
  });

  it("passportMetadata aggregates identity + history + credentials + rights + violations", async () => {
    const { passport, verifier, owner, founder, agentWallet } = await deploy();
    await setup(passport, founder, agentWallet);
    await verify(passport, verifier, owner, 1);
    await passport.levelUp(1);

    const m = await passport.passportMetadata(1);
    expect(m.sponsor).to.equal(founder.address);
    expect(m.stake).to.equal(ethers.parseEther("0.2"));
    expect(m.level).to.equal(1);
    expect(m.verificationCount).to.equal(1n);
    expect(m.violationCount).to.equal(0n);
    expect(m.activeCredentialMask).to.equal(1n << BigInt(T.Prediction));
    expect(m.rights.spendLimitPerEpoch).to.equal(ethers.parseEther("0.05"));
  });
});
