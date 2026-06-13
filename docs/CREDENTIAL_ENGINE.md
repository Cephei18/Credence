# Credential Engine — Phase Notes

This phase introduces a **Credential Engine** layered on top of the existing
AgentPassport protocol, transforming the model from:

```
Agent → Level → Rights
```

into:

```
Agent → Verified Outcomes → Credentials → Rights
```

**without** rewriting the protocol, removing levels, redesigning progression, or
breaking any existing test. The engine is purely additive and optional.

---

## 1. Architecture notes

### What was added (4 new files)
| File | Role |
| --- | --- |
| `contracts/interfaces/ICredentialEngine.sol` | Narrow surface AgentPassport calls into the engine. |
| `contracts/libraries/RightsResolver.sol` | Pure `Credential bitmask → Rights` resolution layer. |
| `contracts/CredentialRegistry.sol` | The engine: typed soulbound credentials, state machine, verification history, violations. |
| `contracts/test/CredentialEngine.test.ts` | 9 new tests. |

### What was modified (1 file, additive only)
`contracts/AgentPassport.sol`:
- new optional state `ICredentialEngine public credentialEngine` + `setCredentialEngine` (owner-only)
- three **guarded** hooks: `fulfillVerification` (record + violation), `levelUp` (bridge + RightsExpanded), `revokeRights` (cascade revoke)
- new `passportMetadata(agentId)` aggregation view + `PassportMetadata` struct
- new events `CredentialEngineSet`, `RightsExpanded`, `PassportUpdated`

### The backward-compatibility guarantee
Every engine call in AgentPassport is wrapped in
`if (address(credentialEngine) != address(0)) { … }`. When no engine is wired,
the contract executes exactly as before — which is why the original 12 tests
pass unmodified. The engine is opt-in per deployment.

### Layering
```
AgentPassport (constitution + enforcement)         ← Level → Rights still authoritative for MVP
   │  guarded hooks (verification / level / revoke)
   ▼
CredentialRegistry (Credential Engine)             ← Verified Outcomes → Credentials
   │  activeCredentialMask
   ▼
RightsResolver (pure library)                      ← Credentials → Rights (parallel model)
```

The **bridge** (`syncLevelCredentials`) is how "levels still grant credentials
during MVP" is honored: progression logic lives entirely in AgentPassport; the
engine only *mirrors* the result into typed credentials. The level→credential
map mirrors AgentPassport's Level→Rights table, so credential-derived rights and
level-derived enforcement stay consistent.

### Credential types & the level bridge
| CredentialType | idx | Granted at level | Confers |
| --- | --- | --- | --- |
| Research | 0 | (via research verifications — extensibility hook) | premium access |
| Treasury | 1 | L3 Autonomous | treasury access, spendTier 3 |
| Prediction | 2 | L1 Verified | spendTier 1 |
| Execution | 3 | L2 Trusted | delegation, spendTier 2 |
| Governance | 4 | L2 Trusted | governance access |

---

## 2. Event specification

### CredentialRegistry
| Event | When | Args |
| --- | --- | --- |
| `ControllerUpdated` | controller set | `controller` |
| `CredentialIssued` | None/Revoked/Expired → Pending | `agentId, ctype, expiresAt` |
| `CredentialActivated` | Pending/Suspended → Active | `agentId, ctype` |
| `CredentialSuspended` | Active → Suspended | `agentId, ctype, reason` |
| `CredentialRevoked` | live → Revoked | `agentId, ctype, reason` |
| `CredentialExpired` | live → Expired | `agentId, ctype` |
| `VerificationRecorded` | attestation appended | `agentId, vType, outcome, credentialImpact, verifierSource, index` |
| `ViolationReported` | violation appended | `agentId, severity, reason, reporter, index` |

### AgentPassport (new)
| Event | When | Args |
| --- | --- | --- |
| `CredentialEngineSet` | engine wired | `engine` |
| `RightsExpanded` | level-up grants wider envelope | `agentId, level, spendLimit` |
| `PassportUpdated` | any engine-affecting change | `agentId` |

Every important state transition is observable; `PassportUpdated` gives indexers
a single signal to refresh an agent's aggregated record.

---

## 3. State machine documentation

```
        issueCredential                  activateCredential
 None ───────────────► Pending ──────────────────────────► Active
  ▲                      │                                   │  ▲
  │ (re-issue)           │ activateCredential                │  │ activateCredential
  │                      ▼                                   ▼  │
  └──────── Revoked ◄──────────── revokeCredential ──── Suspended
             ▲   ▲                                          │
             │   │ reportViolation(sev≥3) / revokeAll       │ suspendCredential
             │   └──────────────────────────────────────────┘ reportViolation(sev==2)
             │
   Expired ◄─┴─ expireCredential / past expiresAt (view auto-reflects)
```

**Transition rules (all explicit; invalid transitions revert `InvalidTransition`):**

| From → To | Function | Guard |
| --- | --- | --- |
| None/Revoked/Expired → Pending | `issueCredential` | onlyAuth |
| Pending/Suspended → Active | `activateCredential` | onlyAuth |
| Active → Suspended | `suspendCredential` | onlyAuth |
| any live → Revoked | `revokeCredential` / `revokeAll` | onlyAuth |
| Pending/Active/Suspended → Expired | `expireCredential` | permissionless, requires `expiresAt` set and elapsed |

**Violation response (`reportViolation`):**
- severity 1 → recorded only
- severity 2 → all Active credentials → Suspended
- severity ≥3 → all standing credentials → Revoked

**Expiry semantics:** `credentialState` / `isCredentialActive` treat a
past-`expiresAt` credential as `Expired` in views *without* a write; the
`expireCredential` poke finalizes it on-chain when desired.

---

## 4. Security review

| Area | Assessment |
| --- | --- |
| **Access control** | All mutating engine entrypoints are `onlyAuth` (controller = AgentPassport, or guardian/owner). `expireCredential` is intentionally permissionless but strictly conditioned on an elapsed `expiresAt`. Tested: unauthorized callers revert `NotAuthorized`. |
| **No regression** | Engine hooks in AgentPassport are address-guarded; the original 12 tests pass unchanged. The engine cannot affect a passport that hasn't wired it. |
| **Ordering / state integrity** | Engine calls execute *after* AgentPassport mutates its own core state (level, stake, counters). A reverting engine would revert the whole tx, but core invariants are computed before the external call, so there's no partial-core-state risk. |
| **Reentrancy** | The engine makes no external calls and holds no funds, so it is not a reentrancy source. AgentPassport→engine is a call into trusted, controller-gated code; `withdrawStake` (the only ETH-moving path) remains `nonReentrant` and does not touch the engine. |
| **Soulbound** | Credentials are storage keyed by `agentId` with no transfer/approve surface — non-transferable by construction, matching the passport-name registry. |
| **Griefing** | `reportViolation`/`revokeAll` iterate a fixed 5-element type set — bounded gas, no unbounded loops. |
| **Trust root** | `vType`/`verifierSource` are recorded for auditability; the engine trusts AgentPassport to only forward genuine verifier outcomes (AgentPassport already enforces `NotVerifier`). |
| **Residual risks** | (1) The engine is a trusted dependency of AgentPassport's level/verify/revoke paths — a buggy engine could revert those flows; mitigated by it being deployed/owned by the same guardian and swappable via `setCredentialEngine(0)`. (2) `vType` defaults to Prediction because the verifier interface is intentionally unchanged (see Migration Notes); typed verification requests are future work. (3) Enforcement still reads Level, not credentials — credentials are a parallel/observable model this phase, by design. |

---

## 5. Migration notes

### For existing deployments
- **No storage migration.** New state (`credentialEngine`) is appended; existing
  storage layout is preserved.
- The engine is **opt-in**: deploy `CredentialRegistry`, call
  `engine.setController(passport)` then `passport.setCredentialEngine(engine)`.
  Until then the protocol is byte-for-byte its previous self.
- Agents that leveled up *before* the engine was wired won't have mirrored
  credentials. Re-run the bridge by either calling `syncLevelCredentials` from
  the guardian, or it self-heals on the agent's next `levelUp`.

### Interfaces intentionally NOT changed
- `IOutcomeVerifier` / `IVerificationConsumer.fulfillVerification(requestId,
  agentId, success)` is unchanged, so `MockOutcomeVerifier` and
  `ChainlinkFunctionsVerifier` need no edits. The cost is that verification
  history records a default `vType` (Prediction). **Future work:** carry a
  credential type through `requestVerification` to record typed attestations.
- `getRights` / `attemptAction` are unchanged — enforcement remains
  level-derived for MVP. The credential→rights model is available in parallel
  via `CredentialRegistry.resolveRights` and `passportMetadata`.

### Deploy
`scripts/deploy.ts` now also deploys `CredentialRegistry`, sets AgentPassport as
its controller, and wires it via `setCredentialEngine`. Local/Base Sepolia flows
are otherwise identical.

---

## 6. Result

A passport now represents **Identity + Verified History + Credentials + Rights +
Violations** (see `passportMetadata`), not merely a wallet with a level — moving
the system toward a constitutional framework for autonomous agents while
preserving every existing guarantee.

**Tests:** 21 passing (12 pre-existing + 9 new). No regressions.
