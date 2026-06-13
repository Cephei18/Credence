import { expect } from "chai";
import { simulate, buildHttp, usd, PolicyFixture } from "../scripts/lib/functionsSim";

const POLICY: PolicyFixture = {
  minStableBps: 8000,
  capitalFloorUsd: usd(98_000n),
  minEndBps: 9800, // end >= 98% of start
  startValueUsd: usd(100_000n),
  startBlock: 10,
};

const RISK = ["risk", "0xTreasury", "0xTopic0", "0xSel"];
const TREASURY = ["treasury", "0xTreasury", "0xTopic0", "0xSel"];

describe("Chainlink Functions source.js (Commit 4 — offline)", () => {
  describe("Risk / Discipline", () => {
    it("PASSES a compliant trajectory (min stable >= policy)", async () => {
      const v = await simulate(
        RISK,
        buildHttp({ policy: POLICY, trajectory: [
          { value: usd(100_000n), stableBps: 8500 },
          { value: usd(100_000n), stableBps: 8200 },
          { value: usd(100_000n), stableBps: 9000 },
        ] })
      );
      expect(v).to.equal(1n);
    });

    it("FAILS when the trajectory breaches the stable floor at any point", async () => {
      const v = await simulate(
        RISK,
        buildHttp({ policy: POLICY, trajectory: [
          { value: usd(100_000n), stableBps: 8500 },
          { value: usd(100_000n), stableBps: 3000 }, // breach
          { value: usd(100_000n), stableBps: 9000 }, // tidy-up after — still fails
        ] })
      );
      expect(v).to.equal(0n);
    });

    it("FAILS when there is no recorded behavior (empty log set)", async () => {
      const v = await simulate(RISK, buildHttp({ policy: POLICY, trajectory: [] }));
      expect(v).to.equal(0n);
    });
  });

  describe("Treasury / Stewardship", () => {
    it("PASSES when the floor holds and it ends >= minEnd", async () => {
      const v = await simulate(
        TREASURY,
        buildHttp({ policy: POLICY, trajectory: [
          { value: usd(100_000n), stableBps: 8000 },
          { value: usd(99_000n), stableBps: 8000 },
          { value: usd(99_500n), stableBps: 8000 },
        ] })
      );
      expect(v).to.equal(1n);
    });

    it("FAILS when the capital floor is breached mid-window", async () => {
      const v = await simulate(
        TREASURY,
        buildHttp({ policy: POLICY, trajectory: [
          { value: usd(100_000n), stableBps: 8000 },
          { value: usd(97_000n), stableBps: 8000 }, // < $98k floor
          { value: usd(99_000n), stableBps: 8000 },
        ] })
      );
      expect(v).to.equal(0n);
    });

    it("FAILS on the end check alone (floor holds, but ends below minEnd)", async () => {
      // Higher minEnd (99%) so the end check is stricter than the floor ($98k).
      const strictEnd: PolicyFixture = { ...POLICY, minEndBps: 9900 }; // endThreshold = $99k
      const v = await simulate(
        TREASURY,
        buildHttp({ policy: strictEnd, trajectory: [
          { value: usd(100_000n), stableBps: 8000 },
          { value: usd(99_500n), stableBps: 8000 },
          { value: usd(98_500n), stableBps: 8000 }, // minValue $98.5k >= $98k floor ✓, but end < $99k ✗
        ] })
      );
      expect(v).to.equal(0n);
    });
  });

  describe("Research / Accountability", () => {
    it("PASSES a correct up-call (spot >= target)", async () => {
      const v = await simulate(["research", "ETH-USD", "up", "2500", "0"], buildHttp({ spot: 2600 }));
      expect(v).to.equal(1n);
    });

    it("FAILS a wrong up-call (spot < target)", async () => {
      const v = await simulate(["research", "ETH-USD", "up", "2500", "0"], buildHttp({ spot: 2400 }));
      expect(v).to.equal(0n);
    });

    it("PASSES a correct down-call (spot <= target)", async () => {
      const v = await simulate(["research", "ETH-USD", "down", "2500", "0"], buildHttp({ spot: 2300 }));
      expect(v).to.equal(1n);
    });

    it("FAILS before the deadline matures (cannot judge early)", async () => {
      const future = Math.floor(Date.now() / 1000) + 3600;
      const v = await simulate(["research", "ETH-USD", "up", "2500", String(future)], buildHttp({ spot: 9999 }));
      expect(v).to.equal(0n);
    });
  });
});
