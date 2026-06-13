import { expect } from "chai";
import { ethers } from "hardhat";

const PARENT_NODE = ethers.namehash("agentpassport.eth");
const RESEARCH = 0; // AttestationType.Research
const A = { Research: 0, Treasury: 1, Prediction: 2, Execution: 3, Governance: 4, Risk: 5 };

// payload = abi.encode(string[] innerArgs) — what a caller passes to requestTypedVerification.
function payload(innerArgs: string[]) {
  return ethers.AbiCoder.defaultAbiCoder().encode(["string[]"], [innerArgs]);
}

async function deploy() {
  const [owner, founder, workflow, attacker, agentWallet] = await ethers.getSigners();

  const passport = await (await ethers.getContractFactory("AgentPassport")).deploy(owner.address);
  const registry = await (await ethers.getContractFactory("PassportNameRegistry")).deploy(owner.address, PARENT_NODE);
  const engine = await (await ethers.getContractFactory("CredentialRegistry")).deploy(owner.address);
  const cre = await (await ethers.getContractFactory("CREReceiver")).deploy(await passport.getAddress(), owner.address);

  await passport.connect(owner).setVerifier(await cre.getAddress());
  await passport.connect(owner).setNameRegistry(await registry.getAddress());
  await registry.connect(owner).setController(await passport.getAddress());
  await engine.connect(owner).setController(await passport.getAddress());
  await passport.connect(owner).setCredentialEngine(await engine.getAddress());

  // workflowSender = the "workflow" signer (operator EOA bridging CRE sim output).
  await cre.connect(owner).setWorkflowSender(workflow.address);

  // Research issues from a single attestation for a tight end-to-end test.
  await engine.connect(owner).setCredentialRequirement(A.Research, true, 1, false, 0n);

  await passport.connect(founder).registerPrincipal({ value: ethers.parseEther("0.2") });
  await passport.connect(founder).registerAgent(agentWallet.address);

  return { owner, founder, workflow, attacker, agentWallet, passport, registry, engine, cre };
}

// Open a verification request and return its requestId (from the WorkflowTrigger log).
async function request(passport: any, cre: any, agentId: number, attType: number, innerArgs: string[]) {
  const taskId = ethers.keccak256(ethers.toUtf8Bytes(`task:${agentId}:${attType}`));
  const tx = await passport.requestTypedVerification(agentId, attType, taskId, payload(innerArgs), ethers.ZeroHash);
  const rc = await tx.wait();
  let requestId: string | undefined;
  for (const log of rc!.logs) {
    try {
      const p = cre.interface.parseLog(log);
      if (p?.name === "WorkflowTrigger") requestId = p.args.requestId;
    } catch {}
  }
  return requestId!;
}

describe("CREReceiver (Commit 5A)", () => {
  it("runs the full path: request -> WorkflowTrigger -> workflow verdict -> attestation -> credential", async () => {
    const { passport, cre, engine, workflow } = await deploy();

    const requestId = await request(passport, cre, 1, RESEARCH, ["ETH-USD", "up", "1", "0"]);
    expect(requestId).to.not.be.undefined;

    // The workflow (sim output bridged on-chain) delivers the verdict.
    await expect(cre.connect(workflow).fulfillFromWorkflow(requestId, true))
      .to.emit(passport, "OutcomeRecorded")
      .and.to.emit(cre, "VerificationResolved");

    // Attestation recorded + Research credential issued (threshold 1).
    expect(await engine.verificationCount(1)).to.equal(1n);
    const att = await engine.getVerification(1, 0);
    expect(att.vType).to.equal(BigInt(RESEARCH));
    expect(att.outcome).to.equal(true);
    expect(await engine.isCredentialActive(1, A.Research)).to.equal(true);
  });

  it("emits WorkflowTrigger carrying category + decoded args (the CRE trigger)", async () => {
    const { passport, cre } = await deploy();
    const taskId = ethers.keccak256(ethers.toUtf8Bytes("t"));
    await expect(
      passport.requestTypedVerification(1, RESEARCH, taskId, payload(["ETH-USD", "up", "2500", "0"]), ethers.ZeroHash)
    )
      .to.emit(cre, "WorkflowTrigger")
      .withArgs(
        (v: string) => typeof v === "string", // requestId
        1n,
        RESEARCH,
        taskId,
        (args: string[]) => args.length === 4 && args[0] === "ETH-USD"
      );
  });

  it("a failed verdict records a violation (forwarded to AgentPassport)", async () => {
    const { passport, cre, engine, workflow } = await deploy();
    const requestId = await request(passport, cre, 1, RESEARCH, ["ETH-USD", "up", "9999", "0"]);
    await cre.connect(workflow).fulfillFromWorkflow(requestId, false);

    expect(await engine.violationCount(1)).to.equal(1n);
    expect(await engine.isCredentialActive(1, A.Research)).to.equal(false);
  });

  describe("access control", () => {
    it("only AgentPassport (consumer) can open a request", async () => {
      const { cre, attacker } = await deploy();
      await expect(
        cre.connect(attacker).requestVerification(1, ethers.ZeroHash, payload(["x"]))
      ).to.be.revertedWithCustomError(cre, "OnlyConsumer");
    });

    it("only the workflowSender can deliver a verdict", async () => {
      const { passport, cre, attacker } = await deploy();
      const requestId = await request(passport, cre, 1, RESEARCH, ["ETH-USD", "up", "1", "0"]);
      await expect(cre.connect(attacker).fulfillFromWorkflow(requestId, true)).to.be.revertedWithCustomError(
        cre,
        "NotWorkflowSender"
      );
    });

    it("verdicts are rejected until a workflowSender is configured", async () => {
      const [owner, founder, , , agentWallet] = await ethers.getSigners();
      const passport = await (await ethers.getContractFactory("AgentPassport")).deploy(owner.address);
      const cre = await (await ethers.getContractFactory("CREReceiver")).deploy(await passport.getAddress(), owner.address);
      await passport.connect(owner).setVerifier(await cre.getAddress());
      await passport.connect(founder).registerPrincipal({ value: ethers.parseEther("0.2") });
      await passport.connect(founder).registerAgent(agentWallet.address);
      const requestId = await request(passport, cre, 1, RESEARCH, ["ETH-USD", "up", "1", "0"]);
      // workflowSender still unset → any caller rejected.
      await expect(cre.connect(owner).fulfillFromWorkflow(requestId, true)).to.be.revertedWithCustomError(
        cre,
        "NotWorkflowSender"
      );
    });
  });

  describe("replay protection", () => {
    it("a request can only be settled once", async () => {
      const { passport, cre, workflow } = await deploy();
      const requestId = await request(passport, cre, 1, RESEARCH, ["ETH-USD", "up", "1", "0"]);
      await cre.connect(workflow).fulfillFromWorkflow(requestId, true);
      await expect(cre.connect(workflow).fulfillFromWorkflow(requestId, true)).to.be.revertedWithCustomError(
        cre,
        "UnknownRequest"
      );
    });

    it("an unknown requestId is rejected", async () => {
      const { cre, workflow } = await deploy();
      await expect(
        cre.connect(workflow).fulfillFromWorkflow(ethers.id("nope"), true)
      ).to.be.revertedWithCustomError(cre, "UnknownRequest");
    });
  });

  it("fallback: AgentPassport can be swapped back to the mock verifier", async () => {
    const { owner, passport } = await deploy();
    const mock = await (await ethers.getContractFactory("MockOutcomeVerifier")).deploy(
      await passport.getAddress(),
      owner.address
    );
    await passport.connect(owner).setVerifier(await mock.getAddress());
    expect(await passport.verifier()).to.equal(await mock.getAddress());
  });
});
