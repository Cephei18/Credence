# Typed Attestation System — Phase Notes

This phase moves the protocol from:

```
Verification Success → Credential
```

to:

```
Typed Attestation → Credential
```

A credential is now earned **only from a threshold of its own type of
independently verified attestation** — Research credentials from Research
attestations, Treasury credentials from Treasury attestations, and so on. The
change is purely additive: levels, progression, credential issuance, and all
prior tests are untouched.

---

## 1. Attestation architecture notes

### What changed (files)
| File | Change |
| --- | --- |
| `interfaces/ICredentialEngine.sol` | `recordVerification` gains `taskId` + `metadata`; new `evaluateFromAttestation`. |
| `CredentialRegistry.sol` | `Attestation` gains `taskId`/`metadata`; new `CredentialRequirement` config + `setCredentialRequirement` + `evaluateFromAttestation` + `CredentialEarned`/`RequirementUpdated` events. |
| `AgentPassport.sol` | new `AttestationType` enum; per-request typed storage (`pendingAttType`/`pendingTaskId`/`pendingMetadata`); new `requestTypedVerification`; legacy `requestVerification` retained; fulfillment records the **typed** attestation and evaluates eligibility (hardcoded Prediction default removed). |
| `scripts/deploy.ts` | configures per-type requirements. |
| `test/TypedAttestation.test.ts` | 8 new tests. |

### The verifier pipeline (why no verifier contract changed)
The `IOutcomeVerifier` / `IVerificationConsumer.fulfillVerification(requestId,
agentId, success)` interface is intentionally **unchanged**, so
`MockOutcomeVerifier` and `ChainlinkFunctionsVerifier` are untouched. Type +
provenance are carried in AgentPassport's own per-`requestId` storage, set at
request time and read at fulfillment. This preserves type information across the
async DON round-trip without widening the trust surface or breaking either
verifier.

```
requestTypedVerification(agent, attType, taskId, payload, metadata)
        │  store {attType, taskId, metadata} keyed by requestId
        ▼
verifier.requestVerification(agent, taskId, payload) ──► Chainlink/Mock
        ▲                                                    │ resolves outcome
        │  fulfillVerification(requestId, agent, success)    │
        └────────────────────────────────────────◄──────────┘
        │  read {attType, taskId, metadata}; clear (replay protection)
        ▼
engine.recordVerification(typed attestation)  →  engine.evaluateFromAttestation(attType, stake)
```

### Attestation record (permanent)
`Attestation { vType, outcome, credentialImpact, timestamp, verifierSource,
taskId, metadata }`. Every credential is now traceable to the exact chain of
typed attestations — with source and task id — that produced it.

### Extensibility
Adding a new credential/attestation type is: append to the `AttestationType` /
`CredentialType` enums, add a `RightsResolver` bit mapping (if it confers
rights), and configure a `CredentialRequirement`. No storage migration; no
change to fulfillment logic.

---

## 2. Credential eligibility specification

A credential `ctype` is auto-issued (Pending → Active) on a successful matching
attestation **iff** its requirement is enabled and all of:

| Condition | Source |
| --- | --- |
| `creds[agent][ctype].verifications ≥ attestationsRequired` | matching-type successful attestations only |
| `requireNoSevereViolations` ⇒ no severity-≥3 violation | engine violation history |
| `sponsorStake ≥ minSponsorStake` | passed in from AgentPassport (`principals[].stake`) |
| state ∉ {Active, Revoked} | idempotent; never resurrects a punished credential |

### Deploy defaults
| Credential | attestationsRequired | no severe violations | min sponsor stake |
| --- | --- | --- | --- |
| Research (0) | 2 | — | 0 |
| Treasury (1) | 3 | ✅ | 0.2 ETH |
| Prediction (2) | 1 | — | 0 |
| Execution (3) | 2 | — | 0.05 ETH |
| Governance (4) | 2 | — | 0 |

All are owner-configurable via `setCredentialRequirement` and disabled by default
(explicit opt-in), which is why existing tests are unaffected.

### Relationship to levels (backward compatibility)
The legacy `Level → Credential` bridge (`syncLevelCredentials`) still runs on
`levelUp`. The typed-attestation path runs in parallel. Both converge on the
same `Active` credential state machine; whichever path satisfies first activates
the credential. Enforcement (`attemptAction`) remains level-derived for MVP.

---

## 3. Security review

| Threat | Mitigation |
| --- | --- |
| **Attestation spoofing** | Only the registered verifier can call `fulfillVerification` (`NotVerifier`), and only the controller (AgentPassport) can call `engine.recordVerification`/`evaluateFromAttestation` (`onlyAuth`). An attacker cannot inject attestations or self-attest. |
| **Replay attacks** | `pendingVerification[requestId]` is deleted on first fulfillment, so a second fulfillment of the same `requestId` reverts (`UnknownAgent`); the typed context mappings are cleared in the same step. The Mock verifier independently deletes its request record. Tested. |
| **Credential farming** | Attestations originate only from the independent verifier (no self-report); credentials gate on thresholds, sponsor stake, and violation history; stake scales with blast radius (Treasury 0.2 ETH). |
| **Cross-type credential abuse** | A successful attestation increments **only its own type's** counter (`if (vType < TYPE_COUNT) creds[agent][vType].verifications++`), and `evaluateFromAttestation` is invoked with that same type. Research attestations can never satisfy a Treasury credential. Tested. |
| **Invalid credential issuance** | Issuance reads on-chain counters only, is `onlyAuth`, respects the explicit state machine, and refuses to resurrect a `Revoked` credential — so a punished agent cannot re-farm its way back. Tested. |
| **Stake withdrawal race** | `evaluateFromAttestation` reads the sponsor stake at fulfillment time; `withdrawStake`'s existing floor (`_requiredStakeFloor`) and Treasury's `minSponsorStake` keep collateral committed while high-trust credentials stand. |
| **Residual** | (1) Enforcement still reads Level, not credentials (parallel model, by design this phase). (2) `metadata` is a `bytes32` digest — richer payloads should be committed off-chain and hashed in. (3) Single verifier remains the trust root (multi-verifier quorum is future work). |

---

## 4. Tests added (8) — `test/TypedAttestation.test.ts`
- typed credential issued from its own type's threshold
- typed attestation preserves type + provenance (no Prediction default)
- cross-type abuse prevented (wrong-type attestations don't count)
- Treasury gated on no-severe-violations + minimum sponsor stake
- mixed attestation types progress independent credentials
- replay protection (fulfilled request can't resolve twice)
- severe violation blocks Treasury re-issue (anti-farming)
- backward compatibility (legacy `requestVerification` → Prediction attestation)

**Suite total: 29 passing** (12 core + 9 credential engine + 8 typed attestation). No regressions.

---

## 5. Result

Every credential can now be explained: it exists because the agent accumulated a
configured threshold of independently verified attestations *of that credential's
type*, under stake and violation constraints, recorded as permanent on-chain
provenance. Agent Passport moves from a credential registry toward verifiable
trust infrastructure for autonomous agents.
