// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ICredentialEngine} from "./interfaces/ICredentialEngine.sol";
import {RightsResolver} from "./libraries/RightsResolver.sol";

/// @title CredentialRegistry — the Credential Engine
/// @notice First-class credential layer sitting on top of AgentPassport. Turns
///         "Agent → Level → Rights" into "Agent → Verified Outcomes →
///         Credentials → Rights" without redefining progression: AgentPassport
///         still decides when an agent levels up, and (via `syncLevelCredentials`)
///         that level grants the matching credentials here.
///
/// @dev    Credentials are:
///           • typed      — CredentialType enum, extensible
///           • soulbound  — keyed by agentId, no transfer surface
///           • revocable  — explicit Revoked terminal state
///           • queryable  — rich views for the passport explorer
///         A credential moves through an explicit state machine; invalid
///         transitions revert. Verification history and violations are stored
///         as append-only protocol objects. All mutating entrypoints are
///         restricted to the controller (AgentPassport) or the guardian (owner).
contract CredentialRegistry is Ownable, ICredentialEngine {
    using RightsResolver for uint256;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /// @dev Indices MUST match RightsResolver constants.
    enum CredentialType {
        Research,   // 0
        Treasury,   // 1
        Prediction, // 2
        Execution,  // 3
        Governance, // 4
        Risk        // 5 — prerequisite on the Research → Risk → Treasury pathway
    }
    uint8 internal constant TYPE_COUNT = 6;

    /// @notice Explicit credential lifecycle. `None` = never issued.
    enum CredentialState {
        None,      // 0
        Pending,   // 1 — earned in principle, awaiting activation
        Active,    // 2 — in force
        Suspended, // 3 — temporarily disabled (recoverable)
        Revoked,   // 4 — terminal, withdrawn for cause
        Expired    // 5 — lapsed past its validity window
    }

    struct Credential {
        CredentialState state;
        uint64 issuedAt;
        uint64 updatedAt;
        uint64 expiresAt;     // 0 = no expiry
        uint64 verifications; // attestations backing this credential
    }

    /// @notice One immutable, typed entry in an agent's attestation history.
    ///         Permanent protocol record: every credential is traceable to the
    ///         typed attestations that produced it.
    struct Attestation {
        uint8 vType;          // attestation category (≈ CredentialType)
        bool outcome;         // success / failure
        int8 credentialImpact;// signed strength delta
        uint64 timestamp;
        address verifierSource;
        bytes32 taskId;       // provenance: the verified task/claim
        bytes32 metadata;     // provenance: compact attestation metadata
    }

    /// @notice Configurable eligibility for issuing a credential from typed
    ///         attestations. A credential is earned only from attestations of
    ///         its own type (no cross-type abuse).
    struct CredentialRequirement {
        bool enabled;                  // attestation-driven issuance active for this type
        uint64 attestationsRequired;   // successful matching-type attestations needed
        bool requireNoSevereViolations;// block issuance if any severe (sev≥3) violation
        uint256 minSponsorStake;       // minimum sponsor stake (checked via passed-in value)
    }

    /// @notice Protocol-level definition of an attestation category: where the
    ///         truth comes from, what "success" means, and how it affects the
    ///         credential. Declarative and queryable so the verification a
    ///         credential rests on is fully auditable.
    struct AttestationTemplate {
        bool defined;
        address verifierSource;  // expected verifier (0 = any registered verifier)
        bytes32 successCriteria; // commitment to the off-chain success definition / DON source
        int8 credentialImpact;   // strength delta applied on success
        string descriptor;       // human-readable (e.g. "ETH 24h price-direction call")
    }

    /// @notice A first-class violation record.
    struct Violation {
        uint64 timestamp;
        uint8 severity;       // 1 minor · 2 major · 3 critical
        address reporter;
        string reason;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice The AgentPassport contract authorized to drive credential state.
    address public controller;

    mapping(uint256 => mapping(uint8 => Credential)) private _creds; // agentId => type => credential
    mapping(uint256 => Attestation[]) private _history;             // agentId => attestations
    mapping(uint256 => Violation[]) private _violations;            // agentId => violations

    /// @notice Per-credential-type eligibility config (attestation-driven path).
    mapping(uint8 => CredentialRequirement) public requirements;

    /// @notice Bitmask of credential types that must already be Active before a
    ///         given credential can be issued from attestations. Encodes the
    ///         Research → Risk → Treasury pathway. Defaults to 0 (no prereqs),
    ///         which preserves prior behavior.
    mapping(uint8 => uint256) public prerequisites;

    /// @notice Protocol-level template per attestation type.
    mapping(uint8 => AttestationTemplate) public templates;

    // ---------------------------------------------------------------------
    // Events (protocol-grade — every state transition is observable)
    // ---------------------------------------------------------------------

    event ControllerUpdated(address indexed controller);
    event CredentialIssued(uint256 indexed agentId, uint8 indexed ctype, uint64 expiresAt);
    event CredentialActivated(uint256 indexed agentId, uint8 indexed ctype);
    event CredentialSuspended(uint256 indexed agentId, uint8 indexed ctype, string reason);
    event CredentialRevoked(uint256 indexed agentId, uint8 indexed ctype, string reason);
    event CredentialExpired(uint256 indexed agentId, uint8 indexed ctype);
    event VerificationRecorded(
        uint256 indexed agentId,
        uint8 vType,
        bool outcome,
        int8 credentialImpact,
        address verifierSource,
        bytes32 taskId,
        bytes32 metadata,
        uint256 index
    );
    event RequirementUpdated(uint8 indexed ctype, uint64 attestationsRequired, uint256 minSponsorStake);
    event PrerequisitesUpdated(uint8 indexed ctype, uint256 prerequisiteMask);
    event CredentialEarned(uint256 indexed agentId, uint8 indexed ctype, uint64 attestations);
    event AttestationTemplateSet(uint8 indexed attType, address verifierSource, int8 credentialImpact);
    event ViolationReported(
        uint256 indexed agentId,
        uint8 severity,
        string reason,
        address reporter,
        uint256 index
    );

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error NotAuthorized();
    error UnknownType();
    error InvalidTransition(CredentialState from, CredentialState to);
    error NotExpirable();

    modifier onlyAuth() {
        if (msg.sender != controller && msg.sender != owner()) revert NotAuthorized();
        _;
    }

    modifier validType(uint8 ctype) {
        if (ctype >= TYPE_COUNT) revert UnknownType();
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setController(address c) external onlyOwner {
        controller = c;
        emit ControllerUpdated(c);
    }

    // ---------------------------------------------------------------------
    // Credential state machine (explicit transitions; invalid ones revert)
    // ---------------------------------------------------------------------

    /// @notice None|Revoked|Expired → Pending. A credential is "earned" but not
    ///         yet in force until activated.
    function issueCredential(uint256 agentId, uint8 ctype, uint64 expiresAt)
        public
        onlyAuth
        validType(ctype)
    {
        Credential storage c = _creds[agentId][ctype];
        CredentialState s = c.state;
        if (s != CredentialState.None && s != CredentialState.Revoked && s != CredentialState.Expired) {
            revert InvalidTransition(s, CredentialState.Pending);
        }
        c.state = CredentialState.Pending;
        c.issuedAt = uint64(block.timestamp);
        c.updatedAt = uint64(block.timestamp);
        c.expiresAt = expiresAt;
        emit CredentialIssued(agentId, ctype, expiresAt);
    }

    /// @notice Pending|Suspended → Active.
    function activateCredential(uint256 agentId, uint8 ctype)
        public
        onlyAuth
        validType(ctype)
    {
        Credential storage c = _creds[agentId][ctype];
        if (c.state != CredentialState.Pending && c.state != CredentialState.Suspended) {
            revert InvalidTransition(c.state, CredentialState.Active);
        }
        c.state = CredentialState.Active;
        c.updatedAt = uint64(block.timestamp);
        emit CredentialActivated(agentId, ctype);
    }

    /// @notice Active → Suspended (recoverable via activate).
    function suspendCredential(uint256 agentId, uint8 ctype, string calldata reason)
        public
        onlyAuth
        validType(ctype)
    {
        Credential storage c = _creds[agentId][ctype];
        if (c.state != CredentialState.Active) {
            revert InvalidTransition(c.state, CredentialState.Suspended);
        }
        c.state = CredentialState.Suspended;
        c.updatedAt = uint64(block.timestamp);
        emit CredentialSuspended(agentId, ctype, reason);
    }

    /// @notice Any live state → Revoked (terminal).
    function revokeCredential(uint256 agentId, uint8 ctype, string calldata reason)
        public
        onlyAuth
        validType(ctype)
    {
        Credential storage c = _creds[agentId][ctype];
        if (c.state == CredentialState.None || c.state == CredentialState.Revoked) {
            revert InvalidTransition(c.state, CredentialState.Revoked);
        }
        c.state = CredentialState.Revoked;
        c.updatedAt = uint64(block.timestamp);
        emit CredentialRevoked(agentId, ctype, reason);
    }

    /// @notice Pending|Active|Suspended → Expired once past `expiresAt`.
    ///         Permissionless poke (anyone can finalize an objectively lapsed
    ///         credential), but the condition is strict.
    function expireCredential(uint256 agentId, uint8 ctype) external validType(ctype) {
        Credential storage c = _creds[agentId][ctype];
        bool live = c.state == CredentialState.Pending
            || c.state == CredentialState.Active
            || c.state == CredentialState.Suspended;
        if (!live) revert InvalidTransition(c.state, CredentialState.Expired);
        if (c.expiresAt == 0 || block.timestamp < c.expiresAt) revert NotExpirable();
        c.state = CredentialState.Expired;
        c.updatedAt = uint64(block.timestamp);
        emit CredentialExpired(agentId, ctype);
    }

    // ---------------------------------------------------------------------
    // ICredentialEngine — driven by AgentPassport
    // ---------------------------------------------------------------------

    /// @inheritdoc ICredentialEngine
    function recordVerification(
        uint256 agentId,
        uint8 vType,
        bool outcome,
        int8 impact,
        address source,
        bytes32 taskId,
        bytes32 metadata
    ) external onlyAuth {
        uint256 index = _history[agentId].length;
        _history[agentId].push(
            Attestation({
                vType: vType,
                outcome: outcome,
                credentialImpact: impact,
                timestamp: uint64(block.timestamp),
                verifierSource: source,
                taskId: taskId,
                metadata: metadata
            })
        );
        // A successful attestation strengthens ONLY its own credential type —
        // this is what prevents cross-type credential abuse.
        if (outcome && vType < TYPE_COUNT) {
            _creds[agentId][vType].verifications += 1;
        }
        emit VerificationRecorded(agentId, vType, outcome, impact, source, taskId, metadata, index);
    }

    /// @inheritdoc ICredentialEngine
    /// @dev Credential state responds to severity:
    ///        sev 1 → recorded only · sev 2 → suspend active credentials ·
    ///        sev ≥3 → revoke all standing credentials.
    function reportViolation(
        uint256 agentId,
        uint8 severity,
        string calldata reason,
        address reporter
    ) external onlyAuth {
        uint256 index = _violations[agentId].length;
        _violations[agentId].push(
            Violation({
                timestamp: uint64(block.timestamp),
                severity: severity,
                reporter: reporter,
                reason: reason
            })
        );
        emit ViolationReported(agentId, severity, reason, reporter, index);

        if (severity >= 3) {
            _revokeAll(agentId, reason);
        } else if (severity == 2) {
            for (uint8 t = 0; t < TYPE_COUNT; t++) {
                if (_creds[agentId][t].state == CredentialState.Active) {
                    _creds[agentId][t].state = CredentialState.Suspended;
                    _creds[agentId][t].updatedAt = uint64(block.timestamp);
                    emit CredentialSuspended(agentId, t, reason);
                }
            }
        }
    }

    /// @inheritdoc ICredentialEngine
    /// @dev Idempotent bridge: brings every credential the level grants to
    ///      Active, issuing it first if needed. Skips already-active ones.
    function syncLevelCredentials(uint256 agentId, uint8 level) external onlyAuth {
        uint256 mask = _levelMask(level);
        for (uint8 t = 0; t < TYPE_COUNT; t++) {
            if (!RightsResolver.has(mask, t)) continue;
            CredentialState s = _creds[agentId][t].state;
            if (s == CredentialState.Active) continue;
            if (s == CredentialState.None || s == CredentialState.Revoked || s == CredentialState.Expired) {
                // issue → Pending
                _creds[agentId][t].state = CredentialState.Pending;
                _creds[agentId][t].issuedAt = uint64(block.timestamp);
                _creds[agentId][t].updatedAt = uint64(block.timestamp);
                _creds[agentId][t].expiresAt = 0;
                emit CredentialIssued(agentId, t, 0);
            }
            // Pending|Suspended → Active
            _creds[agentId][t].state = CredentialState.Active;
            _creds[agentId][t].updatedAt = uint64(block.timestamp);
            emit CredentialActivated(agentId, t);
        }
    }

    /// @inheritdoc ICredentialEngine
    function revokeAll(uint256 agentId, string calldata reason) external onlyAuth {
        _revokeAll(agentId, reason);
    }

    function _revokeAll(uint256 agentId, string memory reason) internal {
        for (uint8 t = 0; t < TYPE_COUNT; t++) {
            CredentialState s = _creds[agentId][t].state;
            if (s != CredentialState.None && s != CredentialState.Revoked) {
                _creds[agentId][t].state = CredentialState.Revoked;
                _creds[agentId][t].updatedAt = uint64(block.timestamp);
                emit CredentialRevoked(agentId, t, reason);
            }
        }
    }

    // ---------------------------------------------------------------------
    // Attestation-driven credential eligibility (the typed path)
    // ---------------------------------------------------------------------

    /// @notice Configure how a credential type is earned from typed attestations.
    ///         Disabled by default for every type, so enabling it is an explicit,
    ///         backward-compatible opt-in.
    function setCredentialRequirement(
        uint8 ctype,
        bool enabled,
        uint64 attestationsRequired,
        bool requireNoSevereViolations,
        uint256 minSponsorStake
    ) external onlyOwner validType(ctype) {
        requirements[ctype] = CredentialRequirement({
            enabled: enabled,
            attestationsRequired: attestationsRequired,
            requireNoSevereViolations: requireNoSevereViolations,
            minSponsorStake: minSponsorStake
        });
        emit RequirementUpdated(ctype, attestationsRequired, minSponsorStake);
    }

    /// @notice Set the credentials that must already be Active before `ctype`
    ///         can be earned from attestations (e.g. Treasury requires Research
    ///         and Risk). `prerequisiteMask` uses RightsResolver bit indices.
    function setCredentialPrerequisites(uint8 ctype, uint256 prerequisiteMask)
        external
        onlyOwner
        validType(ctype)
    {
        prerequisites[ctype] = prerequisiteMask;
        emit PrerequisitesUpdated(ctype, prerequisiteMask);
    }

    /// @notice Register/replace the protocol template for an attestation type.
    function setAttestationTemplate(
        uint8 attType,
        address verifierSource,
        bytes32 successCriteria,
        int8 credentialImpact,
        string calldata descriptor
    ) external onlyOwner validType(attType) {
        templates[attType] = AttestationTemplate({
            defined: true,
            verifierSource: verifierSource,
            successCriteria: successCriteria,
            credentialImpact: credentialImpact,
            descriptor: descriptor
        });
        emit AttestationTemplateSet(attType, verifierSource, credentialImpact);
    }

    function getAttestationTemplate(uint8 attType)
        external
        view
        validType(attType)
        returns (AttestationTemplate memory)
    {
        return templates[attType];
    }

    /// @inheritdoc ICredentialEngine
    /// @dev Issues+activates `ctype` iff its requirement is enabled and met by
    ///      the agent's matching-type attestation count (and, if configured, no
    ///      severe violations and sufficient sponsor stake). Idempotent; never
    ///      resurrects a Revoked credential (anti-farming after punishment).
    function evaluateFromAttestation(uint256 agentId, uint8 ctype, uint256 sponsorStake)
        external
        onlyAuth
        validType(ctype)
    {
        CredentialRequirement memory req = requirements[ctype];
        if (!req.enabled) return;

        Credential storage c = _creds[agentId][ctype];
        if (c.state == CredentialState.Active) return;       // already held
        if (c.state == CredentialState.Revoked) return;      // punished — no auto re-issue

        if (c.verifications < req.attestationsRequired) return;
        if (req.requireNoSevereViolations && _severeViolationCount(agentId) > 0) return;
        if (sponsorStake < req.minSponsorStake) return;

        // Pathway prerequisites: every required credential must already be Active
        // (Research → Risk → Treasury). Prevents skipping the progression chain.
        uint256 prereq = prerequisites[ctype];
        if (prereq != 0 && (activeCredentialMask(agentId) & prereq) != prereq) return;

        // None/Pending/Suspended/Expired → Active (issuing first if needed).
        if (c.state == CredentialState.None || c.state == CredentialState.Expired) {
            c.state = CredentialState.Pending;
            c.issuedAt = uint64(block.timestamp);
            c.updatedAt = uint64(block.timestamp);
            c.expiresAt = 0;
            emit CredentialIssued(agentId, ctype, 0);
        }
        c.state = CredentialState.Active;
        c.updatedAt = uint64(block.timestamp);
        emit CredentialActivated(agentId, ctype);
        emit CredentialEarned(agentId, ctype, c.verifications);
    }

    function _severeViolationCount(uint256 agentId) internal view returns (uint256 n) {
        Violation[] storage vs = _violations[agentId];
        for (uint256 i = 0; i < vs.length; i++) {
            if (vs[i].severity >= 3) n++;
        }
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Effective state, treating a past-expiry credential as Expired
    ///         without requiring the on-chain poke.
    function credentialState(uint256 agentId, uint8 ctype)
        public
        view
        validType(ctype)
        returns (CredentialState)
    {
        Credential storage c = _creds[agentId][ctype];
        if (
            c.expiresAt != 0 &&
            block.timestamp >= c.expiresAt &&
            (c.state == CredentialState.Active ||
                c.state == CredentialState.Pending ||
                c.state == CredentialState.Suspended)
        ) {
            return CredentialState.Expired;
        }
        return c.state;
    }

    function getCredential(uint256 agentId, uint8 ctype)
        external
        view
        validType(ctype)
        returns (Credential memory)
    {
        return _creds[agentId][ctype];
    }

    function isCredentialActive(uint256 agentId, uint8 ctype)
        public
        view
        validType(ctype)
        returns (bool)
    {
        return credentialState(agentId, ctype) == CredentialState.Active;
    }

    /// @inheritdoc ICredentialEngine
    function activeCredentialMask(uint256 agentId) public view returns (uint256 mask) {
        for (uint8 t = 0; t < TYPE_COUNT; t++) {
            if (isCredentialActive(agentId, t)) mask |= RightsResolver.bit(t);
        }
    }

    /// @notice Full per-type snapshot for the passport explorer.
    function listCredentials(uint256 agentId)
        external
        view
        returns (CredentialState[6] memory states, uint64[6] memory expiries, uint64[6] memory verifications)
    {
        for (uint8 t = 0; t < TYPE_COUNT; t++) {
            states[t] = credentialState(agentId, t);
            expiries[t] = _creds[agentId][t].expiresAt;
            verifications[t] = _creds[agentId][t].verifications;
        }
    }

    /// @notice Capabilities derived from the agent's active credentials.
    function resolveRights(uint256 agentId)
        external
        view
        returns (RightsResolver.ResolvedRights memory)
    {
        return RightsResolver.resolve(activeCredentialMask(agentId));
    }

    // verification history
    function verificationCount(uint256 agentId) external view returns (uint256) {
        return _history[agentId].length;
    }

    function getVerification(uint256 agentId, uint256 index)
        external
        view
        returns (Attestation memory)
    {
        return _history[agentId][index];
    }

    function getVerificationHistory(uint256 agentId)
        external
        view
        returns (Attestation[] memory)
    {
        return _history[agentId];
    }

    // violations
    function violationCount(uint256 agentId) external view returns (uint256) {
        return _violations[agentId].length;
    }

    function getViolations(uint256 agentId) external view returns (Violation[] memory) {
        return _violations[agentId];
    }

    // ---------------------------------------------------------------------
    // Internal — level → credential bridge mapping
    // ---------------------------------------------------------------------

    /// @dev Which credential types a level grants. Mirrors AgentPassport's
    ///      Level → Rights table so credential-derived rights stay consistent
    ///      with level-derived enforcement during MVP.
    ///        L0 → none
    ///        L1 Verified   → Prediction
    ///        L2 Trusted    → Prediction + Execution + Governance
    ///        L3 Autonomous → Prediction + Execution + Governance + Treasury
    function _levelMask(uint8 level) internal pure returns (uint256 mask) {
        if (level >= 1) mask |= RightsResolver.bit(RightsResolver.PREDICTION);
        if (level >= 2) {
            mask |= RightsResolver.bit(RightsResolver.EXECUTION);
            mask |= RightsResolver.bit(RightsResolver.GOVERNANCE);
        }
        if (level >= 3) mask |= RightsResolver.bit(RightsResolver.TREASURY);
    }
}
