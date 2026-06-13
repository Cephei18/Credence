# Agent Passport — ETHGlobal Pitch

## One line
**Credential infrastructure for autonomous agents** — agents earn delegated authority through independently verified behavior, enforced on-chain.

## The problem
AI agents now hold wallets, tools, and budgets. But trust is **all-or-nothing**: an agent is created and immediately handed full authority. There's no graduated trust, no portable track record, no accountable identity behind it. That's how you get an agent with treasury access on day one and no way to know if it has *earned* it.

Humans don't work this way. We earn authority through passports, licenses, certifications, credit scores — earned, portable, revocable, and tied to an accountable identity. **Agents have none of that.**

## The solution
Agent Passport inverts the default:

```
Create agent → minimal rights → verified behavior → credential progression → more rights → more autonomy
```

An agent starts Unverified with a near-zero spend envelope. Each **independently verified** outcome moves it up a credential ladder (Verified → Trusted → Autonomous), unlocking enforced rights: spending, delegation, treasury, governance. The credential is a **soulbound ENS passport**. Misbehavior **slashes stake** and revokes rights. Inactivity **decays** the credential.

## How the sponsors fit (not bolted on — load-bearing)
- **Privy** — *who authorized this agent?* Founder auth + embedded wallets establish the **staked principal**, our Sybil & liability anchor.
- **Smart contracts** — the **constitution** *and* the **enforcement chokepoint**. Rights aren't advertised, they're enforced at the point of action.
- **Chainlink** — **outcome verification.** Agents can't self-report; Functions resolves claims against independent ground truth.
- **ENS** — the **passport itself**: a soulbound subname issued only after the agent earns it.

## Why it's not a reputation-score app
We designed against the attacks that kill naive versions:
- **Sybil?** Rights anchored to a *staked* principal, not the free-to-spawn agent.
- **Self-reporting?** Outcomes only via an *independent verifier*.
- **Sellable reputation?** Credentials are *soulbound* and revocable.
- **Build-trust-then-rug?** *Slashing* + *decay* + stake that *scales with blast radius*.
- **Cosmetic permissions?** Enforced at an on-chain *chokepoint*.

(Full threat model in [WHITEPAPER.md §6](WHITEPAPER.md#6-threat-model).)

## Live demo (90 seconds)
Founder logs in with Privy → stakes as a principal → creates an agent at Level 0 → tries a 0.05 ETH action → **blocked on-chain** → Chainlink verifies an outcome → agent **levels up** → **soulbound ENS passport issued** → the *same* action now **succeeds**. One screen, the whole thesis.

## Status
- ✅ Contracts: `AgentPassport` + soulbound name registry + Chainlink Functions verifier — **12 passing tests** incl. attack cases
- ✅ Frontend: Privy + wagmi, live 8-step flow with a reactive passport card
- ✅ Docs: whitepaper, architecture, contract spec, roadmap, demo script

## The ask / vision
Agent Passport is the missing **trust primitive** for the agent economy. As agents transact autonomously, every protocol will need to ask "how much can I trust this agent?" — and get a verifiable, enforceable, portable answer. We want to make that answer a standard.

## Team
Built at ETHGlobal. Protocol design + contracts + frontend.
