// Credence CRE workflow — production binding (adapter).
//
// The verification LOGIC lives in ./verify.ts (runVerification), validated today
// via simulation. THIS file is the thin CRE wiring: a log-driven trigger on
// CREReceiver.WorkflowTrigger → run the handler → write the verdict back via
// CREReceiver.fulfillFromWorkflow. The actual @chainlink/cre-sdk calls are gated
// (Early Access) and are marked below; everything around them is final.
//
// Trigger model (recommended): EVM-log trigger on WorkflowTrigger — preserves the
// existing request/response semantics (agent → requestTypedVerification →
// CREReceiver emits log → workflow fires), so the protocol does not change.

import { runVerification } from "./verify";
import { CRECapabilities, WorkflowTrigger } from "./creTypes";

/// Decode a raw WorkflowTrigger log into the handler input. In the CRE SDK this
/// uses the generated event decoder; the field layout is fixed by CREReceiver.
export type DecodedTrigger = WorkflowTrigger;

/// Core callback: given a decoded trigger + capabilities, produce {requestId, success}.
/// Runtime-agnostic so it is unit-testable and identical in sim and production.
export async function handleTrigger(
  trigger: DecodedTrigger,
  caps: CRECapabilities
): Promise<{ requestId: string; success: boolean }> {
  const success = await runVerification(trigger, caps);
  return { requestId: trigger.requestId, success };
}

/*
 * PRODUCTION WIRING (CRE SDK — Early Access). Pseudocode of the adapter that
 * compiles to WASM and deploys to the DON. Validated by simulating handleTrigger.
 *
 *   import { cre, evm, http } from "@chainlink/cre-sdk";
 *
 *   export default cre.workflow({
 *     // 1. TRIGGER: WorkflowTrigger log on the deployed CREReceiver.
 *     trigger: evm.logTrigger({ address: CRE_RECEIVER, event: "WorkflowTrigger" }),
 *
 *     // 2. HANDLER: decode → capabilities → verdict → on-chain write.
 *     handler: async (ctx, log) => {
 *       const trigger = decodeWorkflowTrigger(log);
 *       const caps: CRECapabilities = {
 *         httpGetJson: (url) => http.get(ctx, url).then(r => r.json()),
 *         ethCall:    (to, data) => evm.call(ctx, { to, data }),
 *         ethGetLogs: (addr, t0, from, to) => evm.getLogs(ctx, { address: addr, topics: [t0], fromBlock: from, toBlock: to }),
 *       };
 *       const { requestId, success } = await handleTrigger(trigger, caps);
 *
 *       // 3. WRITE: consensus-checked call into CREReceiver.fulfillFromWorkflow.
 *       await evm.write(ctx, {
 *         to: CRE_RECEIVER,
 *         abi: "fulfillFromWorkflow(bytes32,bool)",
 *         args: [requestId, success],
 *       });
 *     },
 *   });
 */
