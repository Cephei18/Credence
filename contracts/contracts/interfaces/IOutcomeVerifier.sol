// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IOutcomeVerifier
/// @notice Abstraction over the source of *independent* ground truth that
///         decides whether an agent actually achieved a claimed outcome.
///
/// @dev    Design note (protocol critique #2): an agent must NEVER self-report
///         success. The verifier is the trust root. Implementations MUST resolve
///         outcomes against a source the agent and its principal cannot influence
///         (Chainlink price feeds, Chainlink Functions over a neutral API,
///         on-chain events, etc.). A `MockOutcomeVerifier` exists ONLY for local
///         demos and tests and must never be used in production.
interface IOutcomeVerifier {
    /// @notice Emitted when a verification request is opened.
    event VerificationRequested(bytes32 indexed requestId, uint256 indexed agentId, bytes32 taskId);
    /// @notice Emitted when an outcome is resolved.
    event VerificationResolved(bytes32 indexed requestId, uint256 indexed agentId, bool success);

    /// @notice Open a verification request for an agent's claimed outcome.
    /// @param agentId    The AgentPassport agent id whose outcome is being checked.
    /// @param taskId     Opaque identifier of the task/claim (e.g. keccak of the prediction).
    /// @param parameters Verifier-specific encoded args (price feed id, API path, threshold...).
    /// @return requestId Correlates the async resolution back to this request.
    function requestVerification(
        uint256 agentId,
        bytes32 taskId,
        bytes calldata parameters
    ) external returns (bytes32 requestId);
}

/// @notice Callback surface the verifier uses to report results to the passport.
interface IVerificationConsumer {
    /// @notice Called by the trusted verifier with the resolved outcome.
    /// @dev MUST be access-controlled to the registered verifier only.
    function fulfillVerification(bytes32 requestId, uint256 agentId, bool success) external;
}
