import { simulate, buildHttp, usd, PolicyFixture } from "./lib/functionsSim";

// Local, LINK-free validation of the DON source across all three modes.
// Run: npm --workspace contracts run simulate

const POLICY: PolicyFixture = {
  minStableBps: 8000,
  capitalFloorUsd: usd(98_000n),
  minEndBps: 9800,
  startValueUsd: usd(100_000n),
  startBlock: 10,
};

// Dummy on-chain identifiers (the mock RPC ignores them).
const RISK_ARGS = ["risk", "0xTreasury", "0xTopic0", "0xGetPolicySel"];
const TREASURY_ARGS = ["treasury", "0xTreasury", "0xTopic0", "0xGetPolicySel"];

async function run(label: string, args: string[], http: any) {
  const v = await simulate(args, http);
  console.log(`${v === 1n ? "PASS" : "FAIL"}  ${label}`);
}

async function main() {
  console.log("Credence — Chainlink Functions source simulation (offline, no LINK)\n");

  // RISK / Discipline
  await run(
    "risk: compliant (min stable 82% >= 80%)",
    RISK_ARGS,
    buildHttp({ policy: POLICY, trajectory: [
      { value: usd(100_000n), stableBps: 8500 },
      { value: usd(100_000n), stableBps: 8200 },
      { value: usd(100_000n), stableBps: 9000 },
    ] })
  );
  await run(
    "risk: breach (dipped to 30% < 80%)",
    RISK_ARGS,
    buildHttp({ policy: POLICY, trajectory: [
      { value: usd(100_000n), stableBps: 8500 },
      { value: usd(100_000n), stableBps: 3000 },
    ] })
  );

  // TREASURY / Stewardship
  await run(
    "treasury: preserved (floor held, ended >= 98%)",
    TREASURY_ARGS,
    buildHttp({ policy: POLICY, trajectory: [
      { value: usd(100_000n), stableBps: 8000 },
      { value: usd(99_000n), stableBps: 8000 },
      { value: usd(99_500n), stableBps: 8000 },
    ] })
  );
  await run(
    "treasury: floor breached (dropped to $97k < $98k)",
    TREASURY_ARGS,
    buildHttp({ policy: POLICY, trajectory: [
      { value: usd(100_000n), stableBps: 8000 },
      { value: usd(97_000n), stableBps: 8000 },
      { value: usd(99_000n), stableBps: 8000 },
    ] })
  );

  // RESEARCH / Accountability
  await run(
    "research: correct up-call (spot 2600 >= 2500)",
    ["research", "ETH-USD", "up", "2500", "0"],
    buildHttp({ spot: 2600 })
  );
  await run(
    "research: wrong up-call (spot 2400 < 2500)",
    ["research", "ETH-USD", "up", "2500", "0"],
    buildHttp({ spot: 2400 })
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
