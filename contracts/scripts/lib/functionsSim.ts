import * as fs from "fs";
import * as path from "path";

// Path to the real DON source executed on Chainlink. We run the SAME file here
// so local validation exercises exactly what the DON will run.
export const SOURCE_PATH = path.join(__dirname, "..", "..", "chainlink", "source.js");

export function loadSource(): string {
  return fs.readFileSync(SOURCE_PATH, "utf8");
}

export type HttpRequest = { url: string; method?: string; headers?: any; data?: any; params?: any };
export type HttpResponse = { data?: any; error?: any; status?: number };
export type HttpMock = (req: HttpRequest) => Promise<HttpResponse>;

/// Minimal stand-in for the Functions global. encodeUint256 mirrors the
/// production 32-byte ABI word so the returned verdict decodes identically.
function makeFunctions(http: HttpMock) {
  return {
    makeHttpRequest: http,
    encodeUint256: (n: number | bigint) => "0x" + BigInt(n).toString(16).padStart(64, "0"),
  };
}

/// Execute source.js exactly as the DON would (top-level await + return),
/// injecting the Functions global and args. Returns the decoded verdict.
export async function simulate(args: string[], http: HttpMock): Promise<bigint> {
  const Functions = makeFunctions(http);
  const src = loadSource();
  // The DON wraps the script in an async function; we do the same so the
  // script's top-level `return`/`await` are valid.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const runner = new Function("Functions", "args", `return (async () => { ${src} })();`);
  const result = await runner(Functions, args);
  return BigInt(result);
}

// ---------------------------------------------------------------------------
// Canned-data encoders — build deterministic on-chain-shaped responses so we
// never touch a real RPC or spend LINK.
// ---------------------------------------------------------------------------

const wordHex = (n: bigint) => n.toString(16).padStart(64, "0");

export type PolicyFixture = {
  minStableBps: number | bigint;
  capitalFloorUsd: bigint;
  minEndBps: number | bigint;
  startValueUsd: bigint;
  windowStart?: number | bigint;
  windowEnd?: number | bigint;
  startBlock?: number | bigint;
};

export function encodePolicy(p: PolicyFixture): string {
  const words = [
    BigInt(p.minStableBps),
    p.capitalFloorUsd,
    BigInt(p.minEndBps),
    p.startValueUsd,
    BigInt(p.windowStart ?? 0),
    BigInt(p.windowEnd ?? 0),
    BigInt(p.startBlock ?? 0),
  ];
  return "0x" + words.map(wordHex).join("");
}

/// One TreasuryAction log (only the fields source.js reads matter).
export function encodeActionLog(totalValueUsd: bigint, stableBps: number | bigint): { data: string } {
  const words = [0n, 0n, 0n, 0n, totalValueUsd, BigInt(stableBps), 0n];
  return { data: "0x" + words.map(wordHex).join("") };
}

export type Trajectory = { value: bigint; stableBps: number }[];

/// Build a mocked Functions.makeHttpRequest from a scenario.
export function buildHttp(scenario: { policy?: PolicyFixture; trajectory?: Trajectory; spot?: number }): HttpMock {
  return async (req: HttpRequest) => {
    if (req.url && req.url.includes("coinbase")) {
      return { data: { data: { amount: String(scenario.spot ?? 0) } } };
    }
    const method = req.data?.method;
    if (method === "eth_call") {
      return { data: { result: encodePolicy(scenario.policy!) } };
    }
    if (method === "eth_getLogs") {
      const logs = (scenario.trajectory ?? []).map((p) => encodeActionLog(p.value, p.stableBps));
      return { data: { result: logs } };
    }
    return { error: "unexpected request" };
  };
}

// USD at feed decimals (8) helper.
export const usd = (n: bigint) => n * 10n ** 8n;
