import { expect } from "chai";
import { runVerification } from "../cre/workflow/verify";
import { AttestationType } from "../cre/workflow/creTypes";
import { buildCaps, buildTrigger, RISK_ARGS, TREASURY_ARGS, Scenario } from "../cre/sim/localRuntime";
import { simulate as simulateSource, buildHttp, usd, PolicyFixture } from "../scripts/lib/functionsSim";

const POLICY: PolicyFixture = {
  minStableBps: 8000,
  capitalFloorUsd: usd(98_000n),
  minEndBps: 9800,
  startValueUsd: usd(100_000n),
  startBlock: 10,
};

// Run the CRE workflow handler for a scenario.
async function cre(attType: AttestationType, args: string[], scenario: Scenario): Promise<boolean> {
  return runVerification(buildTrigger(attType, args), buildCaps(scenario));
}

describe("CRE workflow (Commit 5B)", () => {
  describe("Risk / Discipline", () => {
    it("PASSES a compliant trajectory", async () => {
      expect(await cre(AttestationType.Risk, RISK_ARGS, { policy: POLICY, trajectory: [
        { value: usd(100_000n), stableBps: 8500 }, { value: usd(100_000n), stableBps: 8200 },
      ] })).to.equal(true);
    });
    it("FAILS on a breach at any point", async () => {
      expect(await cre(AttestationType.Risk, RISK_ARGS, { policy: POLICY, trajectory: [
        { value: usd(100_000n), stableBps: 8500 }, { value: usd(100_000n), stableBps: 3000 },
        { value: usd(100_000n), stableBps: 9000 },
      ] })).to.equal(false);
    });
    it("FAILS on empty history", async () => {
      expect(await cre(AttestationType.Risk, RISK_ARGS, { policy: POLICY, trajectory: [] })).to.equal(false);
    });
  });

  describe("Treasury / Stewardship", () => {
    it("PASSES when floor holds and ends >= minEnd", async () => {
      expect(await cre(AttestationType.Treasury, TREASURY_ARGS, { policy: POLICY, trajectory: [
        { value: usd(100_000n), stableBps: 8000 }, { value: usd(99_500n), stableBps: 8000 },
      ] })).to.equal(true);
    });
    it("FAILS when the capital floor is breached", async () => {
      expect(await cre(AttestationType.Treasury, TREASURY_ARGS, { policy: POLICY, trajectory: [
        { value: usd(100_000n), stableBps: 8000 }, { value: usd(97_000n), stableBps: 8000 },
      ] })).to.equal(false);
    });
  });

  describe("Research / Accountability", () => {
    it("PASSES a correct up-call", async () => {
      expect(await cre(AttestationType.Research, ["ETH-USD", "up", "2500", "0"], { spot: 2600 })).to.equal(true);
    });
    it("FAILS a wrong up-call", async () => {
      expect(await cre(AttestationType.Research, ["ETH-USD", "up", "2500", "0"], { spot: 2400 })).to.equal(false);
    });
    it("FAILS before the deadline matures", async () => {
      const future = Math.floor(Date.now() / 1000) + 3600;
      expect(await cre(AttestationType.Research, ["ETH-USD", "up", "2500", String(future)], { spot: 9999 })).to.equal(false);
    });
  });

  describe("PARITY with source.js (identical verdicts)", () => {
    // Each case: same scenario fed to source.js (Functions) and the CRE workflow.
    const cases: { name: string; attType: AttestationType; category: string; innerArgs: string[]; scenario: Scenario }[] = [
      { name: "risk compliant", attType: AttestationType.Risk, category: "risk", innerArgs: RISK_ARGS,
        scenario: { policy: POLICY, trajectory: [{ value: usd(100_000n), stableBps: 8200 }] } },
      { name: "risk breach", attType: AttestationType.Risk, category: "risk", innerArgs: RISK_ARGS,
        scenario: { policy: POLICY, trajectory: [{ value: usd(100_000n), stableBps: 3000 }] } },
      { name: "treasury preserved", attType: AttestationType.Treasury, category: "treasury", innerArgs: TREASURY_ARGS,
        scenario: { policy: POLICY, trajectory: [{ value: usd(99_500n), stableBps: 8000 }] } },
      { name: "treasury floor breach", attType: AttestationType.Treasury, category: "treasury", innerArgs: TREASURY_ARGS,
        scenario: { policy: POLICY, trajectory: [{ value: usd(97_000n), stableBps: 8000 }] } },
      { name: "research pass", attType: AttestationType.Research, category: "research", innerArgs: ["ETH-USD", "up", "2500", "0"],
        scenario: { spot: 2600 } },
      { name: "research fail", attType: AttestationType.Research, category: "research", innerArgs: ["ETH-USD", "up", "2500", "0"],
        scenario: { spot: 2400 } },
    ];

    for (const c of cases) {
      it(`matches source.js: ${c.name}`, async () => {
        // source.js takes [category, ...innerArgs]; CRE takes attType + innerArgs.
        const sourceVerdict = await simulateSource([c.category, ...c.innerArgs], buildHttp(c.scenario as any));
        const creVerdict = await cre(c.attType, c.innerArgs, c.scenario);
        expect(creVerdict).to.equal(sourceVerdict === 1n);
      });
    }
  });
});
