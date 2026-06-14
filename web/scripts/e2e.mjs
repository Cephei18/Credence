// End-to-end smoke test of the full Credence stack against a running local chain
// + the Next server. Mirrors what the browser does, using a fresh random wallet
// as the "Privy embedded wallet" sponsor (no interactive login needed).
//
//   node scripts/e2e.mjs            (chain on 8545, web on http://localhost:3000)
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import {
  createPublicClient, createWalletClient, http, defineChain, parseEther,
  parseAbi, decodeEventLog,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const BASE = process.env.WEB_URL ?? "http://localhost:3000";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const demo = JSON.parse(readFileSync(path.join(__dirname, "..", "public", "demo.json"), "utf8"));

const chain = defineChain({
  id: demo.chainId, name: "local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});
const pub = createPublicClient({ chain, transport: http() });

const ATT = { Research: 0, Treasury: 1, Risk: 5 };
const PASSPORT = parseAbi([
  "function registerPrincipal() payable",
  "function registerAgent(address wallet) returns (uint256)",
  "function levelUp(uint256 agentId)",
  "function treasuryTier(uint256) view returns (uint8)",
  "function getCredential(uint256) view returns (uint8 level,uint64 verifiedCount,uint64 violations,bool live,bool hasPassport,uint256 spentInEpoch,uint256 spendLimit)",
  "function principals(address) view returns (bool registered,uint256 stake,uint256 agentCount,uint256 slashed)",
]);
const ENGINE = parseAbi(["function listCredentials(uint256) view returns (uint8[6],uint64[6],uint64[6])"]);
const AGENT_REGISTERED = parseAbi(["event AgentRegistered(uint256 indexed agentId,address indexed principal,address wallet)"])[0];

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}
async function api(route, body) {
  const r = await fetch(`${BASE}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: r.ok, body: await r.json() };
}
async function readAgent(id) {
  const [list, tier, cred] = await Promise.all([
    pub.readContract({ address: demo.contracts.engine, abi: ENGINE, functionName: "listCredentials", args: [id] }),
    pub.readContract({ address: demo.contracts.passport, abi: PASSPORT, functionName: "treasuryTier", args: [id] }),
    pub.readContract({ address: demo.contracts.passport, abi: PASSPORT, functionName: "getCredential", args: [id] }),
  ]);
  return { states: list[0].map(Number), tier: Number(tier), level: Number(cred[0]), verified: Number(cred[1]), spendLimit: cred[6] };
}

async function main() {
  console.log(`\nCredence E2E  (web=${BASE} chain=${demo.chainId})\n`);

  // 1 · homepage
  console.log("1. Frontend");
  const home = await fetch(BASE);
  const html = await home.text();
  check("homepage 200", home.status === 200, `got ${home.status}`);
  check("homepage renders Credence", /Credence/.test(html));

  // 2 · seeded verdicts via the server CRE bridge
  console.log("2. Server CRE bridge (seeded agents)");
  const riskArgs = (t) => [t, demo.abi.treasuryActionTopic0, demo.abi.getPolicySelector];
  const alpha = await api("/api/verify", { agentId: "1", attType: ATT.Treasury, args: riskArgs(demo.agents[0].treasury) });
  check("Alpha Treasury verify -> PASS", alpha.ok && alpha.body.verdict === true, JSON.stringify(alpha.body));
  const beta = await api("/api/verify", { agentId: "2", attType: ATT.Risk, args: riskArgs(demo.agents[1].treasury) });
  check("Beta Risk verify -> FAIL", beta.ok && beta.body.verdict === false, JSON.stringify(beta.body));

  // 3 · from-zero lifecycle with a fresh "Privy" sponsor wallet
  console.log("3. From-zero agent lifecycle (fresh sponsor wallet)");
  const account = privateKeyToAccount(generatePrivateKey());
  const wallet = createWalletClient({ account, chain, transport: http() });

  const faucet = await api("/api/faucet", { address: account.address });
  check("faucet funds new wallet", faucet.ok && faucet.body.funded === true, JSON.stringify(faucet.body));
  const bal = await pub.getBalance({ address: account.address });
  check("wallet balance > 0.02 ETH", bal >= parseEther("0.02"), `bal=${bal}`);

  // registerPrincipal (0.01) + registerAgent  (mirrors sponsor.createAgent)
  let h = await wallet.writeContract({ address: demo.contracts.passport, abi: PASSPORT, functionName: "registerPrincipal", args: [], value: parseEther("0.01") });
  await pub.waitForTransactionReceipt({ hash: h });
  h = await wallet.writeContract({ address: demo.contracts.passport, abi: PASSPORT, functionName: "registerAgent", args: [account.address] });
  const rc = await pub.waitForTransactionReceipt({ hash: h });
  let agentId;
  for (const log of rc.logs) {
    try { const ev = decodeEventLog({ abi: [AGENT_REGISTERED], data: log.data, topics: log.topics }); if (ev.eventName === "AgentRegistered") agentId = ev.args.agentId; } catch {}
  }
  check("agent created (AgentRegistered)", agentId != null, "");
  if (agentId == null) return;
  console.log(`     new agentId = ${agentId}`);

  // zero state
  const zero = await readAgent(agentId);
  check("starts at Level 0 (Unverified)", zero.level === 0, `level=${zero.level}`);
  check("Research credential not yet active", zero.states[ATT.Research] !== 2, `state=${zero.states[ATT.Research]}`);
  check("treasury tier 0", zero.tier === 0, `tier=${zero.tier}`);

  // earn: 2 Research verifications via the bridge
  const r1 = await api("/api/verify", { agentId: agentId.toString(), attType: ATT.Research, args: demo.agents[0].researchArgs });
  check("Research verify #1 -> PASS", r1.ok && r1.body.verdict === true, JSON.stringify(r1.body));
  const r2 = await api("/api/verify", { agentId: agentId.toString(), attType: ATT.Research, args: demo.agents[0].researchArgs });
  check("Research verify #2 -> PASS", r2.ok && r2.body.verdict === true, JSON.stringify(r2.body));

  const earned = await readAgent(agentId);
  check("Research credential now ACTIVE", earned.states[ATT.Research] === 2, `state=${earned.states[ATT.Research]}`);
  check("verifiedCount == 2", earned.verified === 2, `verified=${earned.verified}`);

  // levelUp -> Verified
  try {
    h = await wallet.writeContract({ address: demo.contracts.passport, abi: PASSPORT, functionName: "levelUp", args: [agentId] });
    await pub.waitForTransactionReceipt({ hash: h });
  } catch (e) { console.log(`     levelUp revert: ${e.shortMessage ?? e.message}`); }
  const leveled = await readAgent(agentId);
  check("leveled up to Verified (1)", leveled.level === 1, `level=${leveled.level}`);
  check("spend authority grew", leveled.spendLimit > zero.spendLimit, `${zero.spendLimit} -> ${leveled.spendLimit}`);

  console.log(`\nResult: ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("E2E crashed:", e); process.exit(1); });
