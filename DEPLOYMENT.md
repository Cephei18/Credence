# Deploying Credence

Two deploy targets — **not three**:

1. **Smart contracts** → deployed once to a public chain (Base Sepolia) via Hardhat.
2. **The Next.js app** (`web/`) → frontend **and** the API/CRE-bridge routes ship together as one unit.

The local Hardhat node is dev-only and is never deployed; on testnet the "chain" is Base Sepolia itself.

```
contracts/  ──deploy+seed──>  Base Sepolia        (writes web/public/demo.json)
web/        ──build+host──>   Vercel / Docker / Node   (reads demo.json, holds operator key server-side)
```

---

## Step 1 — Deploy + seed the contracts (Base Sepolia)

```bash
cd contracts
# contracts/.env:
#   DEPLOYER_PRIVATE_KEY=<funded Base Sepolia key>   # becomes owner + workflowSender
#   BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
#   BETA_PRIVATE_KEY=<optional 2nd key>              # distinct sponsor for Agent Beta; omit for single-key mode
npm run seed:baseSepolia
```

This deploys the full stack (AgentPassport, CredentialRegistry, **CREReceiver**, treasuries, mock feed), seeds Agent Alpha/Beta, and **writes `web/public/demo.json`** — the single source of truth the app reads (addresses, chainId, `workflowSender`, ABI topics, agents).

**Commit the updated `web/public/demo.json`** so it gets bundled into the app build.

> Note: use `seed:baseSepolia`, **not** `deploy:baseSepolia`. The plain `deploy` script wires a `MockOutcomeVerifier`; the app's CRE bridge needs the `CREReceiver` that the seed deploys.

---

## Step 2 — Deploy the web app

The app reads its deployment from the **bundled** `web/public/demo.json` (imported at build time — no runtime filesystem dependency). Set these env vars on the host:

| Var | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | public | Privy app id |
| `OPERATOR_PRIVATE_KEY` | **server-only** | the `workflowSender` EOA; **must be funded** on the target chain (signs CRE verdicts + faucet drips). Never prefix with `NEXT_PUBLIC_`. |
| `BASE_SEPOLIA_RPC_URL` | server-only | RPC the server uses |
| `DEMO_CONFIG_JSON` | server-only, optional | full `demo.json` contents as a string, to point the server at a deployment **without** rebuilding |

### Option A — Vercel (recommended)
1. Import the repo; set **Root Directory = `web`** (Vercel handles the npm workspace install from the repo root).
2. Framework preset: **Next.js** (auto-detected).
3. Add the env vars above in Project Settings.
4. Deploy. (No `vercel.json` needed.)

### Option B — Docker / any host (bulletproof)
```bash
# from repo root
docker build -t credence .
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_PRIVY_APP_ID=... \
  -e OPERATOR_PRIVATE_KEY=0x... \
  -e BASE_SEPOLIA_RPC_URL=https://sepolia.base.org \
  credence
```

### Option C — plain Node host
```bash
npm ci
npm --workspace @agent-passport/web run build
npm --workspace @agent-passport/web run start   # serves on :3000
```

---

## Funding the operator
`OPERATOR_PRIVATE_KEY` is the workflow sender **and** the demo faucet. On Base Sepolia it must hold enough ETH to (a) write verdicts and (b) drip ~0.03 ETH to each new agent's Privy wallet. Top it up from a Base Sepolia faucet; the faucet route returns a clear `503` when it runs low.

## Local development
```bash
cd contracts && npx hardhat node            # terminal 1
npm run seed:demo                           # terminal 2 — writes demo.json (local addresses, 2 accounts)
cd web && npm run dev                        # terminal 3 — http://localhost:3000
```
Reseeding deploys fresh contracts and resets agent ids — after any reseed, **restart the web server** and **refresh the browser** before creating agents (a stale agent id reverts with `UnknownAgent`).
