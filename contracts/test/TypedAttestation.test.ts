import { expect } from "chai";
import { ethers } from "hardhat";

const PARENT_NODE = ethers.namehash("agentpassport.eth");

// AttestationType / CredentialType indices (shared)
const A = { Research: 0, Treasury: 1, Prediction: 2, Execution: 3, Governance: 4 };
const S = { None: 0, Pending: 1, Active: 2, Suspended: 3, Revoked: 4, Expired: 5 };

function task(label: string) {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

async function deploy() {
  const [owner, founder, attacker, agentWallet] = await ethers.getSigners();

  const passport = await (await ethers.getContractFactory("AgentPassport")).deploy(owner.address);
  const nameRegistry = await (await ethers.getContractFactory("PassportNameRegistry")).deploy(
    owner.address,
    PARENT_NODE
  );
  const verifier = await (await ethers.getContractFactory("MockOutcomeVerifier")).deploy(
    await passport.getAddress(),
    owner.address
  );
  const engine = await (await ethers.getContractFactory("CredentialRegistry")).deploy(owner.address);

  await passport.connect(owner).setVerifier(await verifier.getAddress());
  await passport.connect(owner).setNameRegistry(await nameRegistry.getAddress());
  await nameRegistry.connect(owner).setController(await passport.getAddress());
  await engine.connect(owner).setController(await passport.getAddress());
  await passport.connect(owner).setCredentialEngine(await engine.getAddress());

  // Configure typed requirements (mirrors deploy defaults).
  await engine.connect(owner).setCredentialRequirement(A.Research, true, 2, false, 0n);
  await engine.connect(owner).setCredentialRequirement(A.Treasury, true, 3, true, ethers.parseEther("0.2"));
  await engine.connect(owner).setCredentialRequirement(A.Prediction, true, 1, false, 0n);
  await engine.connect(owner).setCredentialRequirement(A.Execution, true, 2, false, ethers.parseEther("0.05"));
  await engine.connect(owner).setCredentialRequirement(A.Governance, true, 2, false, 0n);

  return { owner, founder, attacker, agentWallet, passport, nameRegistry, verifier, engine };
}

// Resolve a TYPED verification of `attType` for an agent.
async function typedVerify(
  passport: any,
  verifier: any,
  owner: any,
  agentId: number,
  attType: number,
  label: string,
  success = true
) {
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
  return requestId!;
}

async function setup(passport: any, founder: any, agentWallet: any, stake = "0.2") {
  await passport.connect(founder).registerPrincipal({ value: ethers.parseEther(stake) });
  await passport.connect(founder).registerAgent(agentWallet.address);
}

describe("TypedAttestationSystem", () => {
  it("issues a credential from a threshold of its OWN attestation type", async () => {
    const { passport, engine, verifier, owner, founder, agentWallet } = await deploy();
    await setup(passport, founder, agentWallet);

    // Research requires 2 successful Research attestations.
    await typedVerify(passport, verifier, owner, 1, A.Research, "research-1");
    expect(await engine.isCredentialActive(1, A.Research)).to.equal(false); // only 1 so far

    await typedVerify(passport, verifier, owner, 1, A.Research, "research-2");
    expect(await engine.isCredentialActive(1, A.Research)).to.equal(true); // threshold met
  });

  it("records typed attestations with preserved type + provenance (no Prediction default)", async () => {
    const { passport, engine, verifier, owner, founder, agentWallet } = await deploy();
    await setup(passport, founder, agentWallet);

    // Resolve a typed Governance verification carrying metadata.
    const reqId = await passport.requestTypedVerification(
      1,
      A.Governance,
      task("gov-claim"),
      "0x",
      ethers.id("meta")
    );
    const rc = await reqId.wait();
    let requestId: string | undefined;
    for (const log of rc!.logs) {
      try {
        const parsed = verifier.interface.parseLog(log);
        if (parsed?.name === "VerificationRequested") requestId = parsed.args.requestId;
      } catch {}
    }
    await verifier.connect(owner).resolve(requestId!, true);

    expect(await engine.verificationCount(1)).to.equal(1n);
    const a = await engine.getVerification(1, 0);
    expect(a.vType).to.equal(BigInt(A.Governance)); // NOT defaulted to Prediction
    expect(a.taskId).to.equal(task("gov-claim"));
    expect(a.metadata).to.equal(ethers.id("meta"));
  });

  it("prevents cross-type credential abuse: wrong-type attestations don't count", async () => {
    const { passport, engine, verifier, owner, founder, agentWallet } = await deploy();
    await setup(passport, founder, agentWallet);

    // Treasury needs 3 Treasury attestations. Feed Research/Prediction instead.
    await typedVerify(passport, verifier, owner, 1, A.Research, "r1");
    await typedVerify(passport, verifier, owner, 1, A.Research, "r2");
    await typedVerify(passport, verifier, owner, 1, A.Prediction, "p1");

    expect(await engine.isCredentialActive(1, A.Treasury)).to.equal(false);
    // Research did meet its own threshold (2) though.
    expect(await engine.isCredentialActive(1, A.Research)).to.equal(true);
  });

  it("gates Treasury on no-severe-violations and minimum sponsor stake", async () => {
    const { passport, engine, verifier, owner, founder, agentWallet } = await deploy();
    // Thin stake: 0.05 < Treasury min 0.2.
    await setup(passport, founder, agentWallet, "0.05");

    for (let i = 0; i < 3; i++) await typedVerify(passport, verifier, owner, 1, A.Treasury, `t${i}`);
    // Met attestation threshold but NOT the stake floor → not issued.
    expect(await engine.isCredentialActive(1, A.Treasury)).to.equal(false);

    // Top up stake to 0.2 and re-attest to trigger re-evaluation.
    await passport.connect(founder).addStake({ value: ethers.parseEther("0.15") });
    await typedVerify(passport, verifier, owner, 1, A.Treasury, "t-final");
    expect(await engine.isCredentialActive(1, A.Treasury)).to.equal(true);
  });

  it("mixed attestation types each progress their own credential independently", async () => {
    const { passport, engine, verifier, owner, founder, agentWallet } = await deploy();
    await setup(passport, founder, agentWallet);

    await typedVerify(passport, verifier, owner, 1, A.Prediction, "p"); // threshold 1 → active
    await typedVerify(passport, verifier, owner, 1, A.Governance, "g1");
    await typedVerify(passport, verifier, owner, 1, A.Governance, "g2"); // threshold 2 → active

    expect(await engine.isCredentialActive(1, A.Prediction)).to.equal(true);
    expect(await engine.isCredentialActive(1, A.Governance)).to.equal(true);
    expect(await engine.isCredentialActive(1, A.Treasury)).to.equal(false);
    expect(await engine.isCredentialActive(1, A.Execution)).to.equal(false);
  });

  it("replay protection: a fulfilled request cannot be resolved twice", async () => {
    const { passport, verifier, owner, founder, agentWallet } = await deploy();
    await setup(passport, founder, agentWallet);

    const reqId = await typedVerify(passport, verifier, owner, 1, A.Research, "r1");
    // Mock cleared its record; resolving again reverts inside the verifier.
    await expect(verifier.connect(owner).resolve(reqId, true)).to.be.revertedWithCustomError(
      verifier,
      "UnknownRequest"
    );
  });

  it("severe violation blocks Treasury re-issue (anti-farming after punishment)", async () => {
    const { passport, engine, verifier, owner, founder, agentWallet } = await deploy();
    await setup(passport, founder, agentWallet);

    // Earn Treasury legitimately.
    for (let i = 0; i < 3; i++) await typedVerify(passport, verifier, owner, 1, A.Treasury, `t${i}`);
    expect(await engine.isCredentialActive(1, A.Treasury)).to.equal(true);

    // Guardian reports a critical (sev 3) violation → revokes all credentials.
    await engine.connect(owner).reportViolation(1, 3, "rug", owner.address);
    expect(await engine.credentialState(1, A.Treasury)).to.equal(BigInt(S.Revoked));

    // Further Treasury attestations must NOT resurrect the revoked credential.
    await typedVerify(passport, verifier, owner, 1, A.Treasury, "t-more");
    expect(await engine.credentialState(1, A.Treasury)).to.equal(BigInt(S.Revoked));
  });

  it("backward compatibility: legacy requestVerification still records a Prediction attestation", async () => {
    const { passport, engine, verifier, owner, founder, agentWallet } = await deploy();
    await setup(passport, founder, agentWallet);

    const tx = await passport.requestVerification(1, task("legacy"), "0x");
    const rc = await tx.wait();
    let requestId: string | undefined;
    for (const log of rc!.logs) {
      try {
        const parsed = verifier.interface.parseLog(log);
        if (parsed?.name === "VerificationRequested") requestId = parsed.args.requestId;
      } catch {}
    }
    await verifier.connect(owner).resolve(requestId!, true);

    const a = await engine.getVerification(1, 0);
    expect(a.vType).to.equal(BigInt(A.Prediction)); // legacy maps to Prediction
    expect(a.taskId).to.equal(task("legacy"));
  });
});
