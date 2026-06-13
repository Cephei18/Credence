# Treasury Credential Framework — Phase Notes

> **Why is this AI agent allowed to touch treasury funds?**
> Because it walked a verifiable chain: independent **Research** attestations →
> independent **Risk** attestations → independent **Treasury** attestations →
> a soulbound **Treasury credential**, under a staked, accountable sponsor — and
> every step is recorded on-chain.

This phase turns the generic credential system into a **trust framework for
autonomous treasury agents**. It is additive: no credential types removed, no
progression logic rewritten, all prior tests green.

---

## 1. Treasury credential architecture

### Core thesis
An agent must not control treasury funds because it *exists*. Treasury authority
is **earned** through a domain-specific, independently verified pathway and
enforced at a dedicated chokepoint.

### The pathway
```
Research Credential  ──►  Risk Credential  ──►  Treasury Credential
   (≥2 Research            (≥2 Risk             (≥2 Treasury attestations
    attestations)           attestations,        + no severe violations
                            prereq: Research)     + min sponsor stake 0.2 ETH
                                                  + prereq: Research & Risk)
```
Each credential is earned **only** from attestations of its own type
(`evaluateFromAttestation`), and `prerequisites[ctype]` requires the prior
credentials to be **Active** first — so the chain cannot be skipped.

### New `Risk` credential type
Added as `CredentialType.Risk` / `AttestationType.Risk` (index 5), `TYPE_COUNT`
6. Existing type indices are unchanged, so all prior masks/tests hold. Risk
confers no standalone rights — it is a pathway prerequisite.

### Treasury rights model (tiers)
A dedicated, **credential-derived** enforcement path, separate from the generic
`attemptAction` (which is untouched — current enforcement preserved):

| Tier | Meaning | Requires | Value cap (default) |
| --- | --- | --- | --- |
| 0 | No treasury actions | — | reverts on any amount |
| 1 | Simulation only | Risk credential active | amount must be 0 |
| 2 | Small-value execution | Treasury credential active | ≤ 1 ETH |
| 3 | Higher-value execution | **full** Research + Risk + Treasury chain | ≤ 10 ETH |

`treasuryTier(agentId)` is a pure read of active credentials;
`attemptTreasuryAction(agentId, amount)` is the chokepoint. Caps are
owner-configurable (`setTreasuryTierCap`).

**Key design point — the level bridge can't shortcut Tier 3.** Reaching
Autonomous still grants the Treasury credential via the legacy bridge (backward
compat), but that yields **Tier 2** only. **Tier 3 requires the complete
attestation chain**, so higher-value treasury authority is reachable only
through verified domain behavior. (Tested.)

### Attestation templates
`CredentialRegistry.templates[attType]` registers, per category, the
`verifierSource`, a `successCriteria` commitment, the `credentialImpact`, and a
human `descriptor` — making the verification each credential rests on auditable
and queryable (`getAttestationTemplate`).

### Files changed
| File | Change |
| --- | --- |
| `libraries/RightsResolver.sol` | add `RISK` (5) |
| `CredentialRegistry.sol` | `Risk` type, `TYPE_COUNT`→6, `[6]` arrays, `prerequisites` + setter + check, `AttestationTemplate` + setter/getter, events |
| `AgentPassport.sol` | `Risk` attestation type, `treasuryTier`, `attemptTreasuryAction`, `treasuryTierCap` + setter, category threading into verifier params |
| `verifiers/ChainlinkFunctionsVerifier.sol` | decode threaded `(attType, payload)`, pass category as DON arg[0], store `attType` |
| `scripts/deploy.ts` | Risk requirement, pathway prerequisites, templates |
| `test/TreasuryFramework.test.ts` | 7 new tests |

---

## 2. Chainlink workflow documentation

The attestation category is now threaded end-to-end so the DON evaluates the
**exact** category requested — no generic verification remains.

```
1. requestTypedVerification(agent, attType=Treasury, taskId, payload, metadata)
2. AgentPassport stores {attType, taskId, metadata} by requestId,
   and forwards parameters = abi.encode(attType, payload) to the verifier.
3. ChainlinkFunctionsVerifier decodes (attType, innerArgs), builds DON args as
   [categoryName(attType), ...innerArgs], runs the audited JS `source` on the DON.
   → args[0] = "treasury" tells the source which category to evaluate.
4. DON resolves the outcome against independent ground truth, returns bool.
5. fulfillRequest → consumer.fulfillVerification(requestId, agent, success).
6. AgentPassport records a TYPED Treasury attestation and calls
   engine.evaluateFromAttestation(Treasury, sponsorStake):
     • ≥2 Treasury attestations? • no severe violations? • stake ≥ 0.2 ETH?
     • Research & Risk credentials Active? → issue+activate Treasury credential.
7. treasuryTier(agent) now reflects the new authority; attemptTreasuryAction
   enforces it.
```

**Per-category sources.** `setSource` holds the audited JS; the category arg lets
one source branch per category, or operators can deploy a verifier per category
and register it in each template's `verifierSource`. The `successCriteria`
commitment in the template pins the agreed definition of success for auditors.

---

## 3. Treasury security review

| Threat | Mitigation |
| --- | --- |
| **Malicious agent** | Cannot self-attest (only the registered verifier resolves outcomes; only the controller records them). Cannot skip the chain (prerequisites). Cannot exceed its tier cap (`attemptTreasuryAction`). Can be paused (`pauseAgent`) and downgraded. |
| **Sponsor abuse** | Treasury requires `minSponsorStake` (0.2 ETH) that is slashable and floor-locked (`withdrawStake` floor). The sponsor is the accountable, capital-at-risk identity behind the agent — abuse burns their stake. |
| **Credential farming** | Three independent gates: typed-attestation thresholds *per category*, no-severe-violations, and minimum stake. Attestations originate only from the independent verifier, so volume can't be self-manufactured. |
| **Treasury escalation** | Tier 3 (higher-value) requires the **complete** Research+Risk+Treasury chain; the level bridge alone caps at Tier 2. No single shortcut reaches max authority. Tier caps bound the blast radius at every tier. |
| **Replay attacks** | `pendingVerification[requestId]` is consumed on first fulfillment; a replayed fulfillment reverts. Typed context (`pendingAttType/TaskId/Metadata`) is cleared in the same step. The Chainlink/Mock verifiers also delete their own request record. (Tested.) |
| **Collusion between agents** | Credentials are soulbound and per-agent; one agent's standing can't be lent to another. Rights are non-transferable and each agent's tier derives solely from its own active credentials. Sponsors that bankroll colluding agents share one slashable stake pool. |
| **Re-farming after punishment** | A severe (sev≥3) violation revokes credentials, and `evaluateFromAttestation` refuses to resurrect a `Revoked` credential — so an exploiter cannot re-earn treasury authority by piling on more attestations. (Tested.) |
| **Residual risks** | (1) Single verifier remains the trust root — multi-verifier quorum is future work. (2) `attemptTreasuryAction` enforces tier/amount but, like the generic chokepoint, must be wired as the actual spend path (Safe module / session key) in production to be physically unavoidable. (3) `successCriteria` is a commitment — the off-chain DON source must be published for auditors. |

---

## 4. Tests added (7) — `test/TreasuryFramework.test.ts`
- Treasury issued only after the full Research → Risk → Treasury chain
- prerequisites enforced (Treasury / Risk attestations alone can't skip)
- treasury rights expand across tiers (0 → 1 simulation → 3 execution)
- level-bridge Treasury (Autonomous) grants Tier 2, **not** Tier 3
- treasury authority revoked on severe violation
- Treasury gated on minimum sponsor stake even with the full chain
- attestation templates are registered and queryable

**Suite total: 36 passing** (12 core + 9 credential engine + 8 typed attestation + 7 treasury). No regressions.

---

## 5. Success criterion met
The protocol can now answer *"why is this agent allowed to touch treasury
funds?"* with a fully verifiable chain: typed independent attestations →
prerequisite-gated credentials → a credential-derived treasury tier → enforced
value caps → a staked, slashable sponsor. Trust is earned, scoped, and revocable.
