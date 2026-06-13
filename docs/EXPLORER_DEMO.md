# Credence Explorer — 60-Second Demo

The Explorer makes the whole thesis legible at a glance: **Behavior → Verification → Credential → Authority.**

## Setup (once)
```bash
# terminal A — local chain
npm --workspace contracts run node

# terminal B — seed Alpha (compliant) + Beta (breaching), writes web/public/demo.json
npm --workspace contracts run seed:demo

# terminal C — frontend
npm --workspace web run dev     # open http://localhost:3000/explorer
```
The Explorer reads the local chain directly (viem public client) — **no wallet/login required to view.**

> Sanity-check the seeded state any time: `node web/scripts/checkReads.mjs`

## The walkthrough (~60s)

**[0:00] Frame it.** "Credence lets autonomous agents *earn* treasury authority through independently verified behavior. Here are two agents."

**[0:10] Agent Alpha (compliant).** Point at the passport: **Research ✅ Risk ✅ Treasury ⏳**, Treasury tier rising.
- **Trajectory chart:** stable allocation stays above the 80% floor the whole window; value preserved. "A Chainlink CRE workflow verified this *entire trajectory*, not a snapshot."
- **Timeline:** Research → Risk attestations earned the credentials.

**[0:30] The live moment.** Click **"Verify Treasury via CRE."** The pipeline runs — *WorkflowTrigger → CRE workflow → verdict PASS → credential issued* — Treasury credential flips **Active** and **Treasury tier → 3**. The Authority panel now shows higher-value execution unlocked.

**[0:45] Agent Beta (breaching).** Switch agents. Same policy, but the **trajectory dips to 30% stable** (red breach marker). The **timeline shows the violation**; Research is **Suspended**, Risk **denied**, **tier 0** — Authority panel: treasury actions **blocked**.

**[0:55] Land it.** "Same protocol, opposite outcomes — decided entirely by *verified behavior*. That's why this agent can touch treasury funds, and that one can't."

## What the judge sees
- **Behavior** (trajectory chart) → **Verification** (CRE pipeline) → **Credential** (timeline + passport) → **Authority** (tier + allowed/denied actions).
- A live CRE verification running the **real workflow handler** (parity-tested against `source.js`).
- Compliant vs breaching, side by side, with no documentation needed.

## Reliability notes
- Everything runs on the **local stack** — no testnet/CRE-live dependency.
- If anything external hiccups, the pre-seeded state already tells the full story; the live button is the only on-chain action.
