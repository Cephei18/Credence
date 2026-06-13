// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ICredentialEngine
/// @notice The narrow surface `AgentPassport` uses to drive the Credential
///         Engine. Kept deliberately small so the constitution (AgentPassport)
///         stays decoupled from credential internals and the engine can be
///         upgraded/replaced behind this interface.
///
/// @dev    Every mutating call here is access-controlled inside the engine to
///         the registered controller (the AgentPassport contract) or the
///         guardian. AgentPassport only ever invokes these when an engine is
///         wired (`address != 0`), so the base protocol is unaffected when no
///         engine is set — this is the backward-compatibility guarantee.
interface ICredentialEngine {
    /// @notice Append an immutable, typed attestation to an agent's history.
    /// @param vType    Attestation/credential category (see CredentialType).
    /// @param outcome  True on a verified success, false on a failure.
    /// @param impact   Signed effect on credential strength (+1 / -1 for MVP).
    /// @param source   The verifier that produced this outcome (trust source).
    /// @param taskId   The verified task/claim id (provenance).
    /// @param metadata Compact attestation metadata (provenance).
    function recordVerification(
        uint256 agentId,
        uint8 vType,
        bool outcome,
        int8 impact,
        address source,
        bytes32 taskId,
        bytes32 metadata
    ) external;

    /// @notice Evaluate whether a typed attestation now makes the matching
    ///         credential eligible, and issue+activate it if so. Idempotent and
    ///         no-op when the credential's requirement is disabled. `sponsorStake`
    ///         is supplied by AgentPassport (which owns stake accounting).
    function evaluateFromAttestation(uint256 agentId, uint8 ctype, uint256 sponsorStake) external;

    /// @notice Record a violation and let credential state respond to it
    ///         (severity 2 suspends active credentials, severity ≥3 revokes them).
    function reportViolation(
        uint256 agentId,
        uint8 severity,
        string calldata reason,
        address reporter
    ) external;

    /// @notice Bridge: ensure the credentials granted by `level` are issued and
    ///         active. This is how "levels still grant credentials" during MVP
    ///         progression without the engine redefining progression logic.
    function syncLevelCredentials(uint256 agentId, uint8 level) external;

    /// @notice Revoke every standing credential for an agent (guardian downgrade).
    function revokeAll(uint256 agentId, string calldata reason) external;

    /// @notice Bitmask of currently-active credential types for an agent.
    ///         Bit i set ⇔ CredentialType(i) is Active and unexpired.
    function activeCredentialMask(uint256 agentId) external view returns (uint256);
}
