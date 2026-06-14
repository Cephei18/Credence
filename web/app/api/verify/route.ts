import { NextResponse } from "next/server";
import { keccak256, toHex, encodeAbiParameters, decodeEventLog, zeroHash, parseAbi } from "viem";
import { serverClients } from "@/lib/serverChain";
import { runVerification, viemCaps } from "@/lib/creCompute";

// The Chainlink CRE bridge, server-side. Given a typed verification request it:
//   1. opens the request on AgentPassport (operator-signed),
//   2. independently REPLAYS the agent's behavior (runVerification = the workflow),
//   3. writes the PASS/FAIL verdict through CREReceiver as the workflowSender.
// The operator key never leaves the server. This is the only thing that can turn
// behavior into a credential — never the client.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PASSPORT_ABI = parseAbi([
  "function requestTypedVerification(uint256,uint8,bytes32,bytes,bytes32) returns (bytes32)",
  // declared so viem can decode a custom revert into a readable name
  "error UnknownAgent()",
  "error AgentIsPaused()",
  "error NotVerifier()",
]);
const CRE_ABI = parseAbi(["function fulfillFromWorkflow(bytes32,bool)"]);
const WORKFLOW_TRIGGER = parseAbi([
  "event WorkflowTrigger(bytes32 indexed requestId,uint256 indexed agentId,uint8 attType,bytes32 taskId,string[] args)",
])[0];

export async function POST(req: Request) {
  try {
    const { agentId, attType, args } = (await req.json()) as {
      agentId: string;
      attType: number;
      args: string[];
    };
    if (agentId == null || attType == null || !Array.isArray(args)) {
      return NextResponse.json({ error: "bad request" }, { status: 400 });
    }

    const { cfg, publicClient, wallet } = await serverClients();
    const account = wallet.account!;

    // 1 · open the typed request
    const taskId = keccak256(toHex(`api:${agentId}:${attType}:${args.join("|")}`));
    const payload = encodeAbiParameters([{ type: "string[]" }], [args]);
    const reqHash = await wallet.writeContract({
      address: cfg.contracts.passport,
      abi: PASSPORT_ABI,
      functionName: "requestTypedVerification",
      args: [BigInt(agentId), attType, taskId, payload, zeroHash],
      account,
      chain: wallet.chain,
    });
    const reqReceipt = await publicClient.waitForTransactionReceipt({ hash: reqHash });

    let requestId: `0x${string}` | undefined;
    for (const log of reqReceipt.logs) {
      try {
        const ev = decodeEventLog({ abi: [WORKFLOW_TRIGGER], data: log.data, topics: log.topics });
        if (ev.eventName === "WorkflowTrigger") requestId = (ev.args as any).requestId;
      } catch {}
    }
    if (!requestId) return NextResponse.json({ error: "no WorkflowTrigger emitted" }, { status: 500 });

    // 2 · independently compute the verdict (the CRE workflow)
    const verdict = await runVerification(attType, args, viemCaps(publicClient));

    // 3 · write the verdict as the authenticated workflow sender
    const writeHash = await wallet.writeContract({
      address: cfg.contracts.creReceiver,
      abi: CRE_ABI,
      functionName: "fulfillFromWorkflow",
      args: [requestId, verdict],
      account,
      chain: wallet.chain,
    });
    await publicClient.waitForTransactionReceipt({ hash: writeHash });

    return NextResponse.json({ requestId, verdict });
  } catch (e: any) {
    // viem stashes the decoded custom-error name in metaMessages (and the raw
    // selector deep in the cause), not in shortMessage — search all of them.
    const hay = [
      e?.shortMessage,
      e?.message,
      Array.isArray(e?.metaMessages) ? e.metaMessages.join(" ") : "",
      typeof e?.walk === "function" ? e.walk((x: any) => x?.data?.errorName)?.data?.errorName : "",
    ]
      .filter(Boolean)
      .map(String)
      .join(" | ");

    // UnknownAgent (0x0df2949d): the id doesn't exist on the current deployment,
    // usually a stale agent after the chain was reseeded.
    if (hay.includes("UnknownAgent") || hay.includes("0x0df2949d")) {
      return NextResponse.json(
        { error: "This agent doesn't exist on the current chain (it may have been reset). Refresh the page and create a new agent." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: e?.shortMessage ?? e?.message ?? "verification failed" }, { status: 500 });
  }
}
