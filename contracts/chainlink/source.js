// Credence — Chainlink Functions verification source.
//
// Runs on the Chainlink DON. Independently evaluates an agent's behavior and
// returns Functions.encodeUint256(1) on PASS / (0) on FAIL. It never trusts the
// agent: for Risk/Treasury it reads the COMMITTED policy and the full
// TreasuryAction trajectory straight from chain; for Research it reads a neutral
// public price. Chainlink verifies behavior across time, not a snapshot.
//
// ARGS CONTRACT (the on-chain ChainlinkFunctionsVerifier injects args[0]=category):
//   research : [ "research", assetPair, direction("up"|"down"), targetUsd, deadlineUnix ]
//   risk     : [ "risk",     treasuryAddress, treasuryActionTopic0, getPolicySelector ]
//   treasury : [ "treasury", treasuryAddress, treasuryActionTopic0, getPolicySelector ]
//
// Selectors/topics are passed in (cheap, non-sensitive ABI constants) so the
// DON needs no in-sandbox keccak. The DON still reads the real contract state.

const category = args[0];

// Public Base Sepolia JSON-RPC (keyless). Overridable via env in production.
const RPC_URL = "https://sepolia.base.org";

function word(hex, i) {
  const start = 2 + i * 64; // skip "0x", 32-byte words
  return BigInt("0x" + hex.slice(start, start + 64));
}

function verdict(ok) {
  return Functions.encodeUint256(ok ? 1 : 0);
}

async function rpc(method, params) {
  const res = await Functions.makeHttpRequest({
    url: RPC_URL,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    data: { jsonrpc: "2.0", method, params, id: 1 },
  });
  if (res.error || !res.data || res.data.error) throw Error("rpc failure");
  return res.data.result;
}

// ---------------------------------------------------------------- RESEARCH
if (category === "research") {
  const assetPair = args[1]; // e.g. "ETH-USD"
  const direction = args[2]; // "up" | "down"
  const target = Number(args[3]);
  const deadline = Number(args[4]);

  // The forecast must have matured (committed before, judged after).
  if (Math.floor(Date.now() / 1000) < deadline) return verdict(false);

  const r = await Functions.makeHttpRequest({
    url: `https://api.coinbase.com/v2/prices/${assetPair}/spot`,
  });
  if (r.error || !r.data || !r.data.data) throw Error("price failure");
  const spot = Number(r.data.data.amount);

  const ok = direction === "up" ? spot >= target : spot <= target;
  return verdict(ok);
}

// ------------------------------------------------ RISK / TREASURY (behavior)
const treasury = args[1];
const topic0 = args[2];
const getPolicySelector = args[3];

// 1) Read the COMMITTED policy from chain (not from the agent).
const policyHex = await rpc("eth_call", [{ to: treasury, data: getPolicySelector }, "latest"]);
const policyMinStableBps = word(policyHex, 0);
const capitalFloorUsd = word(policyHex, 1);
const policyMinEndBps = word(policyHex, 2);
const startValueUsd = word(policyHex, 3);
const startBlock = word(policyHex, 6);

// 2) Read the full TreasuryAction trajectory since the window opened.
const logs = await rpc("eth_getLogs", [
  {
    address: treasury,
    topics: [topic0],
    fromBlock: "0x" + startBlock.toString(16),
    toBlock: "latest",
  },
]);

// No behavior recorded → nothing to attest to.
if (!logs || logs.length === 0) return verdict(false);

// 3) Reconstruct worst-case metrics across the WHOLE window.
//    data words: [actionType, stableBalance, volatileBalance, ethUsdPrice,
//                 totalValueUsd, stableBps, timestamp]
let minStableBps = 10000n;
let minValueUsd = (1n << 255n);
let endValueUsd = 0n;
for (let k = 0; k < logs.length; k++) {
  const d = logs[k].data;
  const totalValueUsd = word(d, 4);
  const stableBps = word(d, 5);
  if (stableBps < minStableBps) minStableBps = stableBps;
  if (totalValueUsd < minValueUsd) minValueUsd = totalValueUsd;
  endValueUsd = totalValueUsd; // logs are returned in chronological order
}

if (category === "risk") {
  // Discipline: never dropped below the committed stable floor.
  return verdict(minStableBps >= policyMinStableBps);
}

if (category === "treasury") {
  // Stewardship: capital floor held all window AND ended near start value.
  const floorOk = minValueUsd >= capitalFloorUsd;
  const endOk = endValueUsd >= (startValueUsd * policyMinEndBps) / 10000n;
  return verdict(floorOk && endOk);
}

throw Error("unknown category");
