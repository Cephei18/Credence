# Agent Passport

**Credential infrastructure for autonomous agents.** Agents don't receive authority when they're created — their authorizing human/org *earns* a progressively wider, enforceable delegation envelope as the agent accumulates **independently verified** behavior.

> Humans earn authority through passports, licenses, certifications, and credit scores.
> Autonomous agents have wallets, prompts, and tools — but no concept of *earned* authority.
> Agent Passport is that missing primitive.

---

## The inversion

| Today | Agent Passport |
| --- | --- |
| Create agent → full authority | Create agent → **minimal** rights |
| Trust assumed | Trust **earned** through verified outcomes |
| Self-reported success | **Independently verified** outcomes (Chainlink) |
| Static permissions | Rights **expand and decay** with behavior |
| Identity = a wallet key | Identity = a **soulbound, revocable** ENS passport |

```
Create agent → minimal rights → verified behavior → credential progression → more rights → more autonomy
```

## Sponsor integrations

- **Privy** — *who authorized this agent?* Founder auth + embedded wallets + the staked **principal** that anchors Sybil-resistance and liability.
- **Smart contracts** — the *constitution* and the **enforcement chokepoint** that decides what an agent may do.
- **Chainlink** — *outcome verification.* Agents can't self-report; Chainlink Functions resolves claims against independent ground truth.
- **ENS** — *the passport itself.* A soulbound subname issued **only after** eligibility — a portable credential, not a name handed out on day one.

## Architecture

```
┌─ Frontend (Next.js + Privy + wagmi) ── the magical flow UI
│
├─ AgentPassport.sol ──────────────────── constitution + enforcement chokepoint
│     • principal stake (Sybil/liability anchor)
│     • level/rights model, soulbound credential
│     • decay, slashing, pause/revoke
│
├─ IOutcomeVerifier ───────────────────── independent ground truth
│     • ChainlinkFunctionsVerifier (prod)
│     • MockOutcomeVerifier (demo/tests)
│
└─ PassportNameRegistry ───────────────── soulbound, revocable ENS-style subnames
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/WHITEPAPER.md](docs/WHITEPAPER.md), and [docs/SMART_CONTRACT_SPEC.md](docs/SMART_CONTRACT_SPEC.md).

### Credential Engine (`Agent → Verified Outcomes → Credentials → Rights`)

On top of the level/rights core sits an optional, additive **Credential Engine**
([CredentialRegistry.sol](contracts/contracts/CredentialRegistry.sol)): typed, soulbound, revocable credentials with an
explicit state machine, persistent verification history, and first-class
violations. Levels still grant credentials (the MVP bridge), and a dedicated
[RightsResolver](contracts/contracts/libraries/RightsResolver.sol) derives rights from credentials in parallel. It's
wired only when present, so the base protocol is unchanged without it. Full
write-up — architecture, event spec, state machine, security review, migration —
in [docs/CREDENTIAL_ENGINE.md](docs/CREDENTIAL_ENGINE.md).

On top of that, a **Typed Attestation System** ensures credentials are earned
only from domain-specific verified outcomes — Research credentials from Research
attestations, Treasury from Treasury, etc. — with configurable thresholds, stake
and violation gating, and permanent attestation provenance
([docs/ATTESTATION_SYSTEM.md](docs/ATTESTATION_SYSTEM.md)).

### Treasury Credential Framework

The flagship use case: a **trust framework for autonomous treasury agents**. An
agent earns treasury authority only by walking a verifiable pathway —
**Research → Risk → Treasury** credentials, each from its own independent
attestations, prerequisite-gated and stake-backed — enforced through
credential-derived treasury tiers (simulation → small → higher-value execution)
at a dedicated `attemptTreasuryAction` chokepoint. It answers *"why is this AI
agent allowed to touch treasury funds?"* with a complete attestation chain. See
[docs/TREASURY_FRAMEWORK.md](docs/TREASURY_FRAMEWORK.md).

## Rights model

| Level | Name | Spend / epoch | Delegation | Treasury | Governance | Verified outcomes needed | Min principal stake |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | Unverified | 0.0005 ETH | — | — | — | 0 | 0.001 ETH |
| 1 | Verified | 0.05 ETH | — | — | — | 1 | 0.01 ETH |
| 2 | Trusted | 0.5 ETH | ✅ | — | ✅ | 3 | 0.05 ETH |
| 3 | Autonomous | 5 ETH | ✅ | ✅ | ✅ | 6 | 0.2 ETH |

*(All parameters are configurable on-chain; values above are the demo defaults.)*

## Quickstart (local demo)

```bash
# 1. install
npm install

# 2. compile + test the protocol
npm run compile
npm test          # 36 passing — progression + attacks + credential engine + typed attestations + treasury

# 3. run a local chain (terminal A)
npm --workspace contracts run node

# 4. deploy + wire the stack (terminal B)
npm run deploy:local
#    → copy the printed addresses into web/.env.local and contracts/.env (VERIFIER_ADDRESS)

# 5. run the frontend (terminal C)
cp web/.env.local.example web/.env.local   # add NEXT_PUBLIC_PRIVY_APP_ID + addresses
npm run web                                 # http://localhost:3000
```

Driving the demo: walk the 8 steps in the UI. When you hit **Request verification**, resolve the
mock outcome from a terminal:

```bash
VERIFIER_ADDRESS=<addr> AGENT_ID=1 SUCCESS=true npm --workspace contracts run resolve
```

Then **Level up → Issue passport → Retry action** — the action blocked at Level 0 now succeeds.

## Deploy to Base Sepolia

```bash
cp contracts/.env.example contracts/.env   # add DEPLOYER_PRIVATE_KEY (funded on Base Sepolia)
npm run deploy:baseSepolia
```

For production verification, deploy `ChainlinkFunctionsVerifier` against the Base Sepolia Functions
router, fund a subscription, set the audited JS source, and point the passport at it with `setVerifier`.

## Repo layout

```
contracts/   Hardhat project — Solidity, tests, deploy/resolve scripts
web/         Next.js app — Privy auth, wagmi, the flow UI
docs/        Whitepaper, architecture, contract spec, roadmap, pitch, demo script
```

## What makes this credible (not just a badge)

This isn't a reputation score app. The design survives the attacks that kill naive versions — see
[docs/WHITEPAPER.md](docs/WHITEPAPER.md#threat-model):

- **Sybil** — rights anchored to a *staked principal*, not the (free-to-spawn) agent.
- **Self-reporting** — outcomes resolved only by an independent verifier.
- **Sellable reputation** — credentials are *soulbound* and revocable.
- **Goodhart / exit-scam** — *slashable* stake + *decaying* credentials + stake scaling with blast radius.
- **Cosmetic permissions** — rights enforced at an on-chain *chokepoint*, not stored as advisory metadata.
