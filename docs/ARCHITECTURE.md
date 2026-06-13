# Architecture

## Layers

```
┌──────────────────────────────────────────────────────────────────────┐
│  L1  Frontend — Next.js (App Router) · Privy · wagmi/viem · Tailwind   │
│      The "magical flow": login → stake → create agent → blocked →      │
│      verify → level up → passport → unblocked.                         │
└───────────────┬────────────────────────────────────────────────────────┘
                │ wagmi writes / reads
┌───────────────▼────────────────────────────────────────────────────────┐
│  L2  AgentPassport.sol — constitution + ENFORCEMENT CHOKEPOINT          │
│      principals · agents · levels · rights · violations · stake         │
│      registerPrincipal · registerAgent · attemptAction · levelUp ·      │
│      issuePassport · pauseAgent · revokeRights · slashing · decay       │
└───────┬───────────────────────────────────────────────┬─────────────────┘
        │ requestVerification / fulfillVerification        │ issue / revoke
┌───────▼───────────────────────────────┐   ┌─────────────▼─────────────────┐
│  L4  IOutcomeVerifier                  │   │  L5  PassportNameRegistry      │
│   • ChainlinkFunctionsVerifier (prod)  │   │   soulbound ENS-style subnames │
│   • MockOutcomeVerifier (demo/tests)   │   │   issue / revoke / resolve     │
│   independent ground truth (Chainlink) │   │   (ENS L2 / NameWrapper in prod)│
└────────────────────────────────────────┘   └────────────────────────────────┘
```

## Identity & authorization (Privy)

- The **founder** logs in via Privy (email / wallet / Google). Privy provisions an **embedded wallet** if they don't have one.
- That wallet becomes the **principal** — the staked, accountable identity. `registerPrincipal()` posts the bond.
- The principal authorizes agents via `registerAgent(agentWallet)`. The agent's operating wallet is also a Privy-managed (embedded/delegated) wallet.
- Privy answers the single question the credential system is built on: **who authorized this agent?**

## The enforcement chokepoint

`attemptAction(agentId, amount)` is the gate every privileged action passes through:

1. Reject if the agent is paused or unknown.
2. Roll the spend epoch forward if `EPOCH` has elapsed.
3. Compute the **live** rights (after decay): if the credential is stale, collapse to the Level 0 envelope.
4. Reject if `spentInEpoch + amount` exceeds the level's `spendLimitPerEpoch`.
5. Otherwise record the spend and allow.

In production this contract is installed as a **Safe module** / session-key policy so that agent funds physically cannot move without passing the check — the credential becomes enforcement, not decoration.

## Verification flow (Chainlink)

```
agent claims outcome (taskId, params)
        │  requestVerification(agentId, taskId, params)
        ▼
AgentPassport ──► IOutcomeVerifier.requestVerification ──► Chainlink DON
        ▲                                                      │ runs audited JS
        │  fulfillVerification(requestId, agentId, success)    │ against neutral source
        └──────────────────────────────────────────────◄──────┘ fulfillRequest callback
```

- Only the registered verifier may call `fulfillVerification` (access-controlled by address).
- Success → `verifiedCount++`, `lastVerifiedAt = now`.
- Failure → `violations++`, **slash** principal stake, **downgrade** one level.

## Progression & decay

- `levelUp(agentId)` is permissionless (objective checks): enough verified outcomes **and** a recent (non-decayed) success **and** principal stake covering the next level.
- `verificationTtl` (default 30 days) defines "recent". `getRights`/`attemptAction` treat a stale credential as Level 0.

## Naming / passport (ENS)

- At `passportEligibleAt` (Level 1) the principal calls `issuePassport(agentId, label)`.
- `PassportNameRegistry.issue` mints a soulbound subname under `agentpassport.eth`, computing the standard ENS namehash so it resolves identically when fronted by an ENS L2 resolver (Durin) or a mainnet NameWrapper-controlled parent.
- No transfer surface exists → soulbound by construction. `revoke` is controller-only.

## Deployment topology (Base Sepolia)

| Contract | Role | Owner/controller |
| --- | --- | --- |
| `AgentPassport` | constitution + chokepoint | guardian (deployer) |
| `PassportNameRegistry` | soulbound names | controller = AgentPassport |
| `MockOutcomeVerifier` *(demo)* | operator-resolved outcomes | operator = deployer |
| `ChainlinkFunctionsVerifier` *(prod)* | DON-resolved outcomes | guardian; funded subscription |

## Frontend state

The UI is a thin, reactive view over chain state. It reads `principals`, `getCredential`, `getRights`, and `nameOf`, and writes the lifecycle functions through wagmi. The `PassportCard` re-renders live as the credential progresses; the step list gates each action on the previous step's on-chain result.
