# Demo Script

A tight, repeatable walkthrough for judges. Target: **~90 seconds** of narration, one screen.

## Pre-flight (before you present)

```bash
# Terminal A — local chain
npm --workspace contracts run node

# Terminal B — deploy + wire, then note the printed addresses
npm run deploy:local
#   AgentPassport: 0x...   PassportNameRegistry: 0x...   MockOutcomeVerifier: 0x...

# Configure the frontend
#   web/.env.local:
#     NEXT_PUBLIC_PRIVY_APP_ID=<your privy app id>
#     NEXT_PUBLIC_PASSPORT_ADDRESS=<AgentPassport>
#     NEXT_PUBLIC_REGISTRY_ADDRESS=<PassportNameRegistry>
#   contracts/.env:
#     VERIFIER_ADDRESS=<MockOutcomeVerifier>

# Terminal C — frontend
npm run web   # http://localhost:3000
```

Keep **Terminal B** handy — you'll run one `resolve` command live to simulate the Chainlink callback.

> On Base Sepolia the flow is identical, except verification is resolved by the real Chainlink DON
> instead of the `resolve` command, and the passport name resolves in any ENS-aware client.

## The narration

**[0:00] The problem.**
> "AI agents have wallets and tools — but no concept of *earned* authority. Today you create an agent and hand it full power on day one. Humans don't work like that. We earn authority through credentials. Agent Passport gives agents the same thing."

**[0:15] Step 1–2 — Privy login + stake.**
Click **Founder login**, authenticate. Then **Stake 0.2 ETH & register**.
> "Privy authenticates the human and spins up an embedded wallet. Crucially, rights are anchored to *this staked principal* — not the agent. Agents are free to spawn; stake is not. That's our Sybil defense, and the stake is slashable."

**[0:30] Step 3 — create the agent.**
Click **Authorize new agent**. The passport card appears: **Level 0 · Unverified**, every right locked.
> "The agent is born with almost nothing — a 0.0005 ETH envelope, no delegation, no treasury."

**[0:40] Step 4 — blocked.**
Click **Attempt 0.05 ETH action**. Watch it turn **⛔ blocked**.
> "It tries to spend beyond its envelope and the contract *reverts*. This isn't a label — the passport is an enforcement chokepoint."

**[0:55] Step 5 — verify (Chainlink).**
Click **Request verification**. Then in Terminal B:
```bash
VERIFIER_ADDRESS=<addr> AGENT_ID=1 SUCCESS=true npm --workspace contracts run resolve
```
> "The agent can't self-report. An independent verifier — Chainlink in production — resolves the outcome against neutral ground truth. Here the mock verifier stands in for the DON."

**[1:10] Step 6–7 — level up + passport.**
Click **Level up** (card animates to **Verified**, rights light up), then **Issue passport**.
> "With a recent verified outcome and enough stake, the agent graduates — and earns a *soulbound* ENS passport: `verified-research.agentpassport.eth`. It can't be sold or rented."

**[1:25] Step 8 — unblocked.**
Click **Retry 0.02 ETH action** → **✓ allowed**.
> "The same kind of action that was blocked a minute ago now succeeds. Authority expanded *because behavior was verified*. That's the whole thesis: verified behavior → credential → authority."

## Optional encore (if time)
- **Decay:** explain that without a fresh verified outcome within the TTL, the credential goes stale and rights collapse to Level 0.
- **Slashing:** run `resolve` with `SUCCESS=false` to show a violation slashing stake and downgrading the agent.
- **Guardian:** show `pauseAgent` halting all actions instantly.

## If something breaks
- Action didn't block? Confirm the agent is Level 0 and you used **0.05 ETH** (> 0.0005 envelope).
- `resolve` says no pending request? Make sure you clicked **Request verification** first and `AGENT_ID` matches the card.
- UI shows the yellow banner? Addresses aren't set in `web/.env.local`.
- Reads stale? The UI refetches ~1.5s after each tx; give it a beat or refresh.
