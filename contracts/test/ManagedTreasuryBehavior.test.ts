import { expect } from "chai";
import { ethers } from "hardhat";

const AGENT_ID = 1n;
const FEED_DECIMALS = 8;
const PRICE_2000 = 2000n * 10n ** 8n;

// USD is expressed in feed decimals (8). Helpers for readability.
const usd = (n: bigint) => n * 10n ** 8n; // $n at 8dp
const USDC = (n: bigint) => n * 10n ** 6n; // n USDC (6dp)
const WETH = (n: bigint) => n * 10n ** 18n; // n WETH (18dp)

enum ActionType { Rebalance = 0, Swap = 1, Withdraw = 2 }

async function setup() {
  const [sponsor, operator, attacker] = await ethers.getSigners();
  const stable = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
  const volatile = await (await ethers.getContractFactory("MockERC20")).deploy("Wrapped Ether", "WETH", 18);
  const feed = await (await ethers.getContractFactory("MockV3Aggregator")).deploy(FEED_DECIMALS, PRICE_2000);
  const treasury = await (await ethers.getContractFactory("ManagedTreasury")).deploy(
    AGENT_ID, operator.address, await stable.getAddress(), await volatile.getAddress(), await feed.getAddress(), sponsor.address
  );

  // Fund 80,000 USDC + 10 WETH ($20k) → $100k, 80% stable.
  await stable.mint(sponsor.address, USDC(80_000n));
  await volatile.mint(sponsor.address, WETH(10n));
  await stable.connect(sponsor).approve(await treasury.getAddress(), USDC(80_000n));
  await volatile.connect(sponsor).approve(await treasury.getAddress(), WETH(10n));
  await treasury.connect(sponsor).fund(USDC(80_000n), WETH(10n));

  const t = (await ethers.provider.getBlock("latest"))!.timestamp;
  await treasury.connect(sponsor).commitPolicy(8000, usd(98_000n), 9800, usd(100_000n), t, t + 7 * 24 * 3600);

  return { sponsor, operator, attacker, stable, volatile, feed, treasury };
}

describe("ManagedTreasury behavior (Commit 3)", () => {
  describe("valuation & stable ratio math", () => {
    it("values the funded portfolio correctly (80k stable + $20k volatile = $100k, 80%)", async () => {
      const { treasury } = await setup();
      const v = await treasury.currentValuation();
      expect(v.stableUsd).to.equal(usd(80_000n));
      expect(v.volatileUsd).to.equal(usd(20_000n));
      expect(v.totalUsd).to.equal(usd(100_000n));
      expect(v.stableBps).to.equal(8000);
      expect(v.price).to.equal(PRICE_2000);
    });

    it("reprices the volatile leg when the feed moves", async () => {
      const { treasury, feed } = await setup();
      await feed.updateAnswer(2500n * 10n ** 8n); // ETH $2000 -> $2500
      const v = await treasury.currentValuation();
      expect(v.volatileUsd).to.equal(usd(25_000n)); // 10 ETH * $2500
      expect(v.totalUsd).to.equal(usd(105_000n));
      // stableBps = 80000/105000 = 7619
      expect(v.stableBps).to.equal(7619);
    });
  });

  describe("actions & access control", () => {
    it("only the operator can act; actions require a committed policy", async () => {
      const { treasury, attacker, operator, sponsor, stable, volatile, feed } = await setup();
      await expect(treasury.connect(attacker).rebalance(5000)).to.be.revertedWithCustomError(treasury, "NotOperator");

      // Fresh treasury without commit → NotCommitted.
      const t2 = await (await ethers.getContractFactory("ManagedTreasury")).deploy(
        2n, operator.address, await stable.getAddress(), await volatile.getAddress(), await feed.getAddress(), sponsor.address
      );
      await expect(t2.connect(operator).rebalance(5000)).to.be.revertedWithCustomError(t2, "NotCommitted");
    });

    it("rebalance hits the target stable ratio (value preserved)", async () => {
      const { treasury, operator } = await setup();
      await treasury.connect(operator).rebalance(5000); // → 50% stable
      const v = await treasury.currentValuation();
      expect(v.stableBps).to.equal(5000);
      expect(v.totalUsd).to.equal(usd(100_000n)); // preserved
    });

    it("swap moves value between legs at the oracle price", async () => {
      const { treasury, operator } = await setup();
      // Swap 20,000 USDC into ETH → stable 60k, volatile $40k → 60% stable.
      await treasury.connect(operator).swap(true, USDC(20_000n));
      const v = await treasury.currentValuation();
      expect(v.stableUsd).to.equal(usd(60_000n));
      expect(v.volatileUsd).to.equal(usd(40_000n));
      expect(v.stableBps).to.equal(6000);
    });
  });

  describe("running aggregates", () => {
    it("tracks worst stable ratio and worst value across actions", async () => {
      const { treasury, operator } = await setup();
      await treasury.connect(operator).rebalance(6000); // 60%
      await treasury.connect(operator).rebalance(4000); // 40% (worst stable)
      await treasury.connect(operator).rebalance(9000); // back to 90%

      expect(await treasury.worstStableBps()).to.equal(4000);
      // value preserved by rebalances → worst value still $100k
      expect(await treasury.worstValueUsd()).to.equal(usd(100_000n));
    });

    it("withdraw lowers worst value (capital outflow)", async () => {
      const { treasury, operator } = await setup();
      await treasury.connect(operator).withdraw(USDC(30_000n), 0); // remove $30k stable
      const v = await treasury.currentValuation();
      expect(v.totalUsd).to.equal(usd(70_000n));
      expect(await treasury.worstValueUsd()).to.equal(usd(70_000n));
    });
  });

  describe("compliant vs breach trajectories (observed, not enforced)", () => {
    it("compliant: stays >= 80% stable → worstStableBps respects policy", async () => {
      const { treasury, operator } = await setup();
      await treasury.connect(operator).rebalance(8500);
      await treasury.connect(operator).rebalance(8200);
      await treasury.connect(operator).rebalance(9000);
      expect(await treasury.worstStableBps()).to.equal(8200);
      expect(await treasury.worstStableBps()).to.be.greaterThanOrEqual(8000); // policy minStableBps
    });

    it("breach: the treasury ALLOWS dropping below policy (discipline is tested, not forced)", async () => {
      const { treasury, operator } = await setup();
      await treasury.connect(operator).rebalance(3000); // 30% stable — a breach, but allowed
      expect(await treasury.worstStableBps()).to.equal(3000);
      expect(await treasury.worstStableBps()).to.be.lessThan(8000); // below policy → future Risk attestation fails
    });
  });

  describe("event emission", () => {
    it("emits TreasuryAction with correct action type and metrics", async () => {
      const { treasury, operator } = await setup();
      await expect(treasury.connect(operator).rebalance(5000))
        .to.emit(treasury, "TreasuryAction")
        .withArgs(
          AGENT_ID,
          ActionType.Rebalance,
          (v: bigint) => v > 0n,            // stableBalance
          (v: bigint) => v > 0n,            // volatileBalance
          PRICE_2000,
          usd(100_000n),
          5000,
          (v: bigint) => v > 0n             // timestamp
        );
    });

    it("emits distinct action types for swap and withdraw", async () => {
      const { treasury, operator } = await setup();
      await expect(treasury.connect(operator).swap(true, USDC(10_000n)))
        .to.emit(treasury, "TreasuryAction").withArgs(
          AGENT_ID, ActionType.Swap,
          (v: bigint) => true, (v: bigint) => true, PRICE_2000,
          (v: bigint) => true, (v: bigint) => true, (v: bigint) => true
        );
      await expect(treasury.connect(operator).withdraw(USDC(5_000n), 0))
        .to.emit(treasury, "TreasuryAction").withArgs(
          AGENT_ID, ActionType.Withdraw,
          (v: bigint) => true, (v: bigint) => true, PRICE_2000,
          (v: bigint) => true, (v: bigint) => true, (v: bigint) => true
        );
    });
  });
});
