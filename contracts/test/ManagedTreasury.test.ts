import { expect } from "chai";
import { ethers } from "hardhat";

const AGENT_ID = 1n;
const FEED_DECIMALS = 8;
const FEED_INITIAL = 2000n * 10n ** 8n; // $2000 ETH/USD

// Policy fixture
const MIN_STABLE_BPS = 8000; // 80%
const CAPITAL_FLOOR = 98_000n;
const MIN_END_BPS = 9800; // 98%
const START_VALUE = 100_000n;

async function deploy() {
  const [sponsor, operator, attacker] = await ethers.getSigners();

  const stable = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
  const volatile = await (await ethers.getContractFactory("MockERC20")).deploy("Wrapped Ether", "WETH", 18);
  const feed = await (await ethers.getContractFactory("MockV3Aggregator")).deploy(FEED_DECIMALS, FEED_INITIAL);

  const treasury = await (await ethers.getContractFactory("ManagedTreasury")).deploy(
    AGENT_ID,
    operator.address,
    await stable.getAddress(),
    await volatile.getAddress(),
    await feed.getAddress(),
    sponsor.address
  );

  return { sponsor, operator, attacker, stable, volatile, feed, treasury };
}

async function now() {
  return (await ethers.provider.getBlock("latest"))!.timestamp;
}

async function commit(treasury: any, signer: any, overrides: Partial<{ ws: number; we: number; minStable: number; floor: bigint; minEnd: number; start: bigint }> = {}) {
  const t = await now();
  const ws = overrides.ws ?? t;
  const we = overrides.we ?? t + 7 * 24 * 3600;
  return treasury
    .connect(signer)
    .commitPolicy(
      overrides.minStable ?? MIN_STABLE_BPS,
      overrides.floor ?? CAPITAL_FLOOR,
      overrides.minEnd ?? MIN_END_BPS,
      overrides.start ?? START_VALUE,
      ws,
      we
    );
}

describe("ManagedTreasury (Commit 2 — skeleton)", () => {
  describe("initialization & agent binding", () => {
    it("binds agentId, operator, assets, feed, and sponsor owner", async () => {
      const { treasury, operator, sponsor, stable, volatile, feed } = await deploy();
      expect(await treasury.agentId()).to.equal(AGENT_ID);
      expect(await treasury.operator()).to.equal(operator.address);
      expect(await treasury.owner()).to.equal(sponsor.address);
      expect(await treasury.stable()).to.equal(await stable.getAddress());
      expect(await treasury.volatileAsset()).to.equal(await volatile.getAddress());
      expect(await treasury.priceFeed()).to.equal(await feed.getAddress());
      expect(await treasury.committed()).to.equal(false);
    });

    it("isOperator reflects the bound agent wallet", async () => {
      const { treasury, operator, attacker } = await deploy();
      expect(await treasury.isOperator(operator.address)).to.equal(true);
      expect(await treasury.isOperator(attacker.address)).to.equal(false);
    });

    it("rejects zero-address constructor params", async () => {
      const [sponsor, operator] = await ethers.getSigners();
      const Factory = await ethers.getContractFactory("ManagedTreasury");
      const stable = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
      const ZERO = ethers.ZeroAddress;
      await expect(
        Factory.deploy(AGENT_ID, ZERO, await stable.getAddress(), await stable.getAddress(), await stable.getAddress(), sponsor.address)
      ).to.be.revertedWith("operator=0");
    });
  });

  describe("operator / access control", () => {
    it("only the sponsor (owner) can commit the policy", async () => {
      const { treasury, operator, attacker } = await deploy();
      await expect(commit(treasury, operator)).to.be.revertedWithCustomError(treasury, "OwnableUnauthorizedAccount");
      await expect(commit(treasury, attacker)).to.be.revertedWithCustomError(treasury, "OwnableUnauthorizedAccount");
    });

    it("only the sponsor (owner) can fund the treasury", async () => {
      const { treasury, attacker } = await deploy();
      await expect(treasury.connect(attacker).fund(1, 0)).to.be.revertedWithCustomError(
        treasury,
        "OwnableUnauthorizedAccount"
      );
    });
  });

  describe("policy creation", () => {
    it("commits a policy, stores all fields, and emits PolicyCommitted", async () => {
      const { treasury, sponsor } = await deploy();
      await expect(commit(treasury, sponsor)).to.emit(treasury, "PolicyCommitted");

      expect(await treasury.committed()).to.equal(true);
      const p = await treasury.getPolicy();
      expect(p.minStableBps).to.equal(MIN_STABLE_BPS);
      expect(p.capitalFloorUsd).to.equal(CAPITAL_FLOOR);
      expect(p.minEndBps).to.equal(MIN_END_BPS);
      expect(p.startValueUsd).to.equal(START_VALUE);
      expect(p.startBlock).to.be.greaterThan(0n);
      expect(p.windowEnd).to.be.greaterThan(p.windowStart);
    });

    it("records startBlock at commit time", async () => {
      const { treasury, sponsor } = await deploy();
      await commit(treasury, sponsor);
      const p = await treasury.getPolicy();
      const bn = await ethers.provider.getBlockNumber();
      expect(p.startBlock).to.equal(BigInt(bn));
    });
  });

  describe("double-commit prevention", () => {
    it("reverts on a second commitPolicy", async () => {
      const { treasury, sponsor } = await deploy();
      await commit(treasury, sponsor);
      await expect(commit(treasury, sponsor)).to.be.revertedWithCustomError(treasury, "AlreadyCommitted");
    });
  });

  describe("invalid policy rejection", () => {
    it("rejects windowEnd <= windowStart", async () => {
      const { treasury, sponsor } = await deploy();
      const t = await now();
      await expect(commit(treasury, sponsor, { ws: t + 100, we: t + 100 })).to.be.revertedWithCustomError(
        treasury,
        "InvalidWindow"
      );
    });

    it("rejects bps > 10000", async () => {
      const { treasury, sponsor } = await deploy();
      await expect(commit(treasury, sponsor, { minStable: 10001 })).to.be.revertedWithCustomError(
        treasury,
        "InvalidBps"
      );
      await expect(commit(treasury, sponsor, { minEnd: 10001 })).to.be.revertedWithCustomError(
        treasury,
        "InvalidBps"
      );
    });

    it("rejects zero start value and floor > start", async () => {
      const { treasury, sponsor } = await deploy();
      await expect(commit(treasury, sponsor, { start: 0n })).to.be.revertedWithCustomError(
        treasury,
        "InvalidStartValue"
      );
      await expect(commit(treasury, sponsor, { floor: START_VALUE + 1n })).to.be.revertedWithCustomError(
        treasury,
        "InvalidStartValue"
      );
    });
  });

  describe("custody setup", () => {
    it("sponsor funds the treasury and balances reflect custody", async () => {
      const { treasury, sponsor, stable, volatile } = await deploy();
      const stableAmt = 80_000n * 10n ** 6n;
      const volAmt = ethers.parseEther("10");

      await stable.mint(sponsor.address, stableAmt);
      await volatile.mint(sponsor.address, volAmt);
      await stable.connect(sponsor).approve(await treasury.getAddress(), stableAmt);
      await volatile.connect(sponsor).approve(await treasury.getAddress(), volAmt);

      await expect(treasury.connect(sponsor).fund(stableAmt, volAmt)).to.emit(treasury, "Funded");

      const [s, v] = await treasury.balances();
      expect(s).to.equal(stableAmt);
      expect(v).to.equal(volAmt);
    });
  });
});
