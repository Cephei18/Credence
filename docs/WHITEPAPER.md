# Agent Passport — Whitepaper

*A credential and rights primitive for autonomous agents.*

## 1. Motivation

Autonomous agents are acquiring wallets, tools, and budgets faster than any framework for *trusting* them. The default architecture is **all-or-nothing**: an agent is spun up and immediately handed whatever authority its operator's key holds. There is no graduated trust, no portable track record, and no way for a counterparty to ask "what has this agent actually proven it can do safely?"

Humans solved this with **credentials**: passports, driver's licenses, professional certifications, credit scores. Each is (a) earned through verified behavior, (b) portable across contexts, (c) revocable, and (d) tied to a real, accountable identity. Agents have none of this.

**Agent Passport** is the missing primitive: a system where an agent's authority is a function of its *independently verified behavior*, enforced on-chain, and carried as a soulbound credential.

## 2. Core thesis

> Authority should be **earned**, not granted on creation.

```
Create agent → minimal rights → verified behavior → credential progression → more rights → more autonomy
```

An agent starts with a near-zero delegation envelope. Each independently verified outcome moves it along a credential ladder; each level unlocks a wider, *enforced* set of rights — spending, delegation, treasury access, governance. Bad outcomes slash stake and revoke rights. Inactivity decays the credential.

## 3. Design principles

1. **The principal is the unit of trust, not the agent.** Agents are free to spawn; humans/orgs are not. Rights are anchored to a staked principal (authenticated via Privy). This is the foundation of Sybil resistance and liability.
2. **No self-reporting.** An agent's claim of success is meaningless. Only an independent verifier (Chainlink) can record an outcome.
3. **Credentials are soulbound.** Earned authority must not be a tradable asset, or a market in "high-trust agents for hire" emerges. Passports are non-transferable and revocable.
4. **Rights are enforced, not advertised.** The passport contract is a chokepoint that privileged actions must pass through. A right the contract can't enforce is just metadata.
5. **Trust is perishable.** Credentials decay; high levels require *recent* verified behavior and stake that scales with blast radius.

## 4. System overview

- **Privy** — founder authentication + embedded wallets. Establishes the principal identity and authorizes agents. Answers *"who authorized this agent?"*
- **AgentPassport.sol** — the constitution. Stores principals, agents, levels, credentials, violations; enforces the delegation envelope; handles progression, decay, slashing, pause/revoke.
- **IOutcomeVerifier** — pluggable independent ground truth. `ChainlinkFunctionsVerifier` runs audited JS on the DON against a neutral data source; `MockOutcomeVerifier` is for local demos/tests.
- **PassportNameRegistry** — issues soulbound, ENS-compatible subnames (e.g. `verified-research.agentpassport.eth`) once an agent is eligible.

## 5. Rights model

| Level | Name | Spend/epoch | Delegate | Treasury | Governance | Verified needed | Min stake |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | Unverified | 0.0005 ETH | — | — | — | 0 | 0.001 ETH |
| 1 | Verified | 0.05 ETH | — | — | — | 1 | 0.01 ETH |
| 2 | Trusted | 0.5 ETH | ✅ | — | ✅ | 3 | 0.05 ETH |
| 3 | Autonomous | 5 ETH | ✅ | ✅ | ✅ | 6 | 0.2 ETH |

Rights are a **pure function of level** — never per-agent mutable state — so they cannot be tampered with independently of the credential. A stale credential collapses to the Level 0 envelope regardless of stored level.

## 6. Threat model

This is the section that separates a real primitive from a reputation-score toy. Each attack below is met by a concrete mechanism in the contract.

### 6.1 Sybil farming
**Attack:** agents are free to create; an attacker spins up thousands, farms cheap verified outcomes, and harvests high-trust rights at scale.
**Defense:** rights are gated by a **principal stake** that scales with level (`minStakeForLevel`). Spawning agents is free; backing them at Trusted/Autonomous costs real, slashable capital. The economic cost of Sybil scales with the authority being claimed.

### 6.2 Self-reported success
**Attack:** an agent (or a colluding endpoint) claims success to level up.
**Defense:** `fulfillVerification` is callable **only** by the registered `IOutcomeVerifier`. Outcomes resolve against independent ground truth (Chainlink price feeds, neutral APIs, on-chain events). The verifier source is committed and auditable.

### 6.3 Sellable / rentable reputation
**Attack:** a Level 3 credential is sold, or the agent key/ENS name is rented to a malicious actor.
**Defense:** credentials and passport names are **soulbound** — the registry exposes no transfer/approve surface — and **revocable** via `revokeRights` / `revoke`. Authority is bound to the principal, not a fungible key.

### 6.4 Goodhart / exit-scam
**Attack:** an agent farms easy verified wins to reach treasury access, then abuses it once (the classic build-trust-then-rug).
**Defense:** three compounding mechanisms — (1) **slashing**: every violation burns principal stake and downgrades the level; (2) **stake scales with blast radius**: Autonomous requires 0.2 ETH at risk; (3) **decay**: a credential not refreshed within `verificationTtl` loses live rights, so trust can't be banked indefinitely and cashed in later.

### 6.5 Cosmetic permissions
**Attack:** the contract records "may spend X" but spending happens elsewhere, so the credential is decorative.
**Defense:** `attemptAction` is the **enforcement chokepoint** — it tracks per-epoch spend and reverts when the envelope is exceeded. In production this is wired as a Safe module / session-key policy so funds physically route through it.

### 6.6 Principal collusion / stake withdrawal
**Attack:** a principal levels an agent up, then yanks stake before misbehaving.
**Defense:** `withdrawStake` enforces a **floor** equal to the highest active agent level's requirement (`_requiredStakeFloor`). Collateral can't be pulled out from under outstanding high-trust delegations.

### 6.7 Verifier compromise
**Residual risk:** the verifier is the trust root; a compromised DON source or feed corrupts outcomes.
**Mitigation:** verifier is swappable (`setVerifier`), sources are auditable, and a protocol guardian can `pauseAgent` / `revokeRights`. Future work: multi-verifier quorum and dispute windows (§8).

## 7. Why on-chain

The credential must be (a) verifiable by any counterparty without trusting the issuer, (b) enforced at the point of action, and (c) portable across applications. Only a public ledger gives all three simultaneously. ENS makes the credential human-legible and resolvable anywhere ENS is read.

## 8. Limitations & future work

- **Outcome semantics are task-specific.** Defining "success" for open-ended agent work is hard; the demo uses an objectively settleable task (price-direction prediction). Generalizing requires a taxonomy of verifiable outcome types.
- **Single verifier.** A quorum of independent verifiers + a dispute/challenge window would reduce the trust-root risk in §6.7.
- **Stake floor scan** is O(n) over a principal's agents (bounded to 256 in the demo); production tracks the max incrementally.
- **Privacy.** All behavior is public. Selective disclosure (ZK attestations of "level ≥ N") is a natural extension.
- **Inter-protocol portability.** A shared schema so other protocols can read and trust Agent Passport credentials directly.

## 9. Conclusion

Agent Passport turns authority into something agents *earn through verified behavior* and carry as a soulbound, enforceable, revocable credential — backed by an accountable staked principal. It is infrastructure for an economy where autonomous agents transact, but only as far as they have proven they can be trusted.
