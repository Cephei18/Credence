# Smart Contract Specification

Solidity `0.8.24`, OpenZeppelin v5, EVM `cancun`. Target: Base Sepolia (84532).

## Contracts

| Contract | Purpose |
| --- | --- |
| `AgentPassport` | Constitution + enforcement chokepoint. Principals, agents, levels, rights, progression, decay, slashing. |
| `PassportNameRegistry` | Soulbound, revocable ENS-style subname issuance. |
| `MockOutcomeVerifier` | Demo/test verifier resolved by an operator. |
| `ChainlinkFunctionsVerifier` | Production verifier resolving outcomes on the Chainlink DON. |
| `IOutcomeVerifier` / `IVerificationConsumer` | Verification request/callback interface. |
| `IPassportNameRegistry` | Naming interface. |

---

## AgentPassport

### Types

```solidity
enum Level { Unverified, Verified, Trusted, Autonomous } // 0..3

struct Principal {            // the staked, accountable human/org (Sybil/liability anchor)
    bool registered;
    uint256 stake;            // slashable bond backing all of this principal's agents
    uint256 agentCount;
    uint256 slashed;          // cumulative stake burned for violations
}

struct Agent {
    address principal;        // who authorized this agent
    address wallet;           // agent operating (Privy) wallet
    Level   level;
    uint64  verifiedCount;    // independently verified successes
    uint64  violations;
    uint64  lastVerifiedAt;   // drives decay
    uint64  epochStart;       // current spend-epoch start
    uint256 spentInEpoch;     // enforcement accounting
    bool    paused;
    bytes32 passportNode;     // ENS node once issued (0 = none)
}

struct Rights {               // pure function of Level — never stored mutable per agent
    uint256 spendLimitPerEpoch;
    bool    canDelegate;
    bool    treasuryAccess;
    bool    governanceAccess;
}
```

### Configuration (owner-settable)

| Param | Default | Meaning |
| --- | --- | --- |
| `EPOCH` | 1 day (const) | Spend accounting window |
| `verificationTtl` | 30 days | Max age of a success before the credential is stale |
| `minStakeForLevel[4]` | `[0.001, 0.01, 0.05, 0.2]` ETH | Principal stake floor per level |
| `verifiedNeededForLevel[4]` | `[0, 1, 3, 6]` | Verified successes to reach each level |
| `passportEligibleAt` | `Verified` (1) | Level at which a passport name may be issued |
| `slashPerViolation` | 0.005 ETH | Stake burned per violation (capped at remaining) |

### Functions

#### Principal lifecycle
- `registerPrincipal() payable` — register caller; requires `msg.value ≥ minStakeForLevel[0]`. Reverts `AlreadyRegistered`, `InsufficientStake`.
- `addStake() payable` — top up to unlock higher levels. Reverts `NotRegistered`.
- `withdrawStake(uint256 amount)` — withdraw down to the floor set by the principal's highest active agent level. Reverts `StakeLocked`. `nonReentrant`.

#### Agent lifecycle
- `registerAgent(address wallet) → uint256 agentId` — authorize an agent at Level 0. Reverts `NotRegistered`. Emits `AgentRegistered`.

#### Enforcement
- `attemptAction(uint256 agentId, uint256 amount) → bool allowed` — **the chokepoint.** Rolls epoch, applies decay, checks the live spend limit, records spend. Reverts `AgentIsPaused`, `UnknownAgent`, or `InsufficientStake` (limit exceeded). Emits `ActionAttempted`.

#### Verification
- `requestVerification(uint256 agentId, bytes32 taskId, bytes parameters) → bytes32 requestId` — open a verification via the verifier; records `pendingVerification`. Emits `VerificationRequested`.
- `fulfillVerification(bytes32 requestId, uint256 agentId, bool success)` — **verifier-only** (`NotVerifier`). Success → `verifiedCount++`, `lastVerifiedAt=now`. Failure → `violations++`, slash, downgrade one level. Emits `OutcomeRecorded` (+ `RightsRevoked` on downgrade).

#### Progression
- `levelUp(uint256 agentId)` — permissionless. Requires `verifiedCount ≥ verifiedNeededForLevel[next]`, credential live (`StaleCredential`), and principal stake ≥ `minStakeForLevel[next]` (`InsufficientStake`). Reverts `NothingToLevel` at cap or if under-verified. Emits `LeveledUp`.
- `issuePassport(uint256 agentId, string label)` — requires `level ≥ passportEligibleAt` (`NotEligibleForPassport`) and no existing node (`PassportAlreadyIssued`). Mints soulbound name. Emits `PassportIssued`.

#### Governance / safety
- `pauseAgent(uint256 agentId, bool paused)` — owner **or** the agent's principal.
- `revokeRights(uint256 agentId, Level to)` — owner-only forced downgrade; revokes passport name if dropping below eligibility. Emits `RightsRevoked`.
- `setVerifier`, `setNameRegistry`, `setVerificationTtl`, `setSlashPerViolation` — owner-only config.

#### Views
- `getRights(agentId) → Rights` — live envelope after decay.
- `getCredential(agentId) → (level, verifiedCount, violations, live, hasPassport, spentInEpoch, spendLimit)`.
- `isCredentialLive(agentId) → bool`.
- public mappings: `principals(address)`, `agents(uint256)`, `pendingVerification(bytes32)`.

### Events
`PrincipalRegistered, StakeAdded, StakeWithdrawn, AgentRegistered, ActionAttempted, VerificationRequested, OutcomeRecorded, LeveledUp, PassportIssued, AgentPaused, RightsRevoked, Slashed`.

### Errors
`NotRegistered, AlreadyRegistered, InsufficientStake, NotPrincipal, NotVerifier, UnknownAgent, AgentIsPaused, NothingToLevel, StaleCredential, NotEligibleForPassport, PassportAlreadyIssued, StakeLocked`.

### Invariants
1. An agent's effective rights never exceed its level's `Rights`, and equal the Level 0 envelope whenever the credential is stale.
2. `fulfillVerification` is reachable only from `verifier`.
3. A principal's stake never drops below `_requiredStakeFloor` via `withdrawStake`.
4. Passport names are unique (`LabelTaken`) and have no transfer path (soulbound).
5. Slashing is bounded by remaining stake; stake is debited before the (best-effort) transfer to prevent griefing.

---

## PassportNameRegistry

- `issue(uint256 agentId, address owner, string label) → bytes32 node` — controller-only; computes `keccak256(parentNode, keccak256(label))`; reverts `LabelTaken`.
- `revoke(uint256 agentId)` — controller-only; deactivates the record and frees the node.
- `nodeOf(agentId) → bytes32`, `nameOf(agentId) → string`, `ownerOfNode(node) → address`.
- `setController(address)` — owner-only.
- **No `transferFrom`/`approve`** — soulbound by construction.

---

## ChainlinkFunctionsVerifier (production)

- Extends `FunctionsClient`. `requestVerification` is **consumer-only**, builds an inline-JS Functions request with `string[]` args decoded from `parameters`, and sends it via the DON (`subscriptionId`, `callbackGasLimit`, `donId`).
- `fulfillRequest` (DON callback) decodes the boolean outcome (non-empty `err` ⇒ failure) and forwards to `AgentPassport.fulfillVerification`.
- Owner config: `setSource(js)`, `setConfig(sub, gas, don)`.
- **Operational note:** commit and audit the JS `source`; it *is* the definition of "success" and must read only neutral, agent-independent data.

---

## Credential Engine (additive layer)

`CredentialRegistry`, `RightsResolver`, and `ICredentialEngine` add the
`Agent → Verified Outcomes → Credentials → Rights` model on top of the core
without changing enforcement. Typed soulbound credentials, an explicit state
machine, verification history, and first-class violations. Full spec:
[CREDENTIAL_ENGINE.md](CREDENTIAL_ENGINE.md).

## Test coverage

`contracts/test/` — 21 passing.

`AgentPassport.test.ts` (12): principal stake gating · Level 0 envelope · chokepoint blocking · verifier-only fulfillment · full magical flow · level-up gating by verified count · stake-floor gating for Autonomous · credential decay · slashing + downgrade on failure · stake-withdraw floor · guardian pause · soulbound + unique names.

`CredentialEngine.test.ts` (9): level→credential bridge · credential→rights derivation · verification history · violation-driven suspension · guardian revoke cascade · explicit state-machine invalid-transition reverts · unauthorized-caller reverts · expiry semantics · passportMetadata aggregation.

## Audit / hardening backlog (post-hackathon)
- Multi-verifier quorum + dispute window.
- Incremental max-level tracking to remove the bounded O(n) stake-floor scan.
- Reentrancy review of slash transfer (currently best-effort, post-debit).
- Formal spec of decay/epoch boundary conditions.
