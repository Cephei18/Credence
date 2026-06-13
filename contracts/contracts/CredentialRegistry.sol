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
        Governance  // 4
    }
    uint8 internal constant TYPE_COUNT = 5;

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

    /// @notice One immutable entry in an agent's verification history.
    struct Attestation {
        uint8 vType;          // verification category (≈ CredentialType)
        bool outcome;         // success / failure
        int8 credentialImpact;// signed strength delta
        uint64 timestamp;
        address verifierSource;
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
        uint256 index
    );
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
        address source
    ) external onlyAuth {
        uint256 index = _history[agentId].length;
        _history[agentId].push(
            Attestation({
                vType: vType,
                outcome: outcome,
                credentialImpact: impact,
                timestamp: uint64(block.timestamp),
                verifierSource: source
            })
        );
        if (outcome && vType < TYPE_COUNT) {
            _creds[agentId][vType].verifications += 1;
        }
        emit VerificationRecorded(agentId, vType, outcome, impact, source, index);
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
        returns (CredentialState[5] memory states, uint64[5] memory expiries, uint64[5] memory verifications)
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
