import { runVerification } from "../cre/workflow/verify";
import { AttestationType } from "../cre/workflow/creTypes";
import { buildCaps, buildTrigger, RISK_ARGS, TREASURY_ARGS } from "../cre/sim/localRuntime";
import { usd, PolicyFixture } from "./lib/functionsSim";

// Local CRE workflow simulation — runs the ported handler with no CRE infra.
// Run: npm --workspace contracts run simulate:cre

const POLICY: PolicyFixture = {
  minStableBps: 8000,
  capitalFloorUsd: usd(98_000n),
  minEndBps: 9800,
  startValueUsd: usd(100_000n),
  startBlock: 10,
};

async function run(label: string, attType: AttestationType, args: string[], scenario: any) {
  const ok = await runVerification(buildTrigger(attType, args), buildCaps(scenario));
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
}

async function main() {
  console.log("Credence — CRE workflow simulation (offline, no CRE deployment)\n");

  await run("risk: compliant (min 82% >= 80%)", AttestationType.Risk, RISK_ARGS, {
    policy: POLICY,
    trajectory: [
      { value: usd(100_000n), stableBps: 8500 },
      { value: usd(100_000n), stableBps: 8200 },
    ],
  });
  await run("risk: breach (30% < 80%)", AttestationType.Risk, RISK_ARGS, {
    policy: POLICY,
    trajectory: [{ value: usd(100_000n), stableBps: 3000 }],
  });
  await run("treasury: preserved", AttestationType.Treasury, TREASURY_ARGS, {
    policy: POLICY,
    trajectory: [
      { value: usd(100_000n), stableBps: 8000 },
      { value: usd(99_500n), stableBps: 8000 },
    ],
  });
  await run("treasury: floor breached ($97k < $98k)", AttestationType.Treasury, TREASURY_ARGS, {
    policy: POLICY,
    trajectory: [
      { value: usd(100_000n), stableBps: 8000 },
      { value: usd(97_000n), stableBps: 8000 },
    ],
  });
  await run("research: correct up-call (2600 >= 2500)", AttestationType.Research, ["ETH-USD", "up", "2500", "0"], {
    spot: 2600,
  });
  await run("research: wrong up-call (2400 < 2500)", AttestationType.Research, ["ETH-USD", "up", "2500", "0"], {
    spot: 2400,
  });
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
