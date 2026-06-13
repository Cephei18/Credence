// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IOutcomeVerifier, IVerificationConsumer} from "../interfaces/IOutcomeVerifier.sol";

/// @title MockOutcomeVerifier
/// @notice DEMO/TEST ONLY. Lets an operator resolve verification requests
///         deterministically so the end-to-end flow can be shown without a live
///         Chainlink DON. In production this is replaced by
///         `ChainlinkFunctionsVerifier`. Never deploy this to mainnet.
contract MockOutcomeVerifier is IOutcomeVerifier {
    address public immutable consumer; // the AgentPassport contract
    address public operator;           // demo driver allowed to resolve
    uint256 public nonce;

    mapping(bytes32 => uint256) public requestAgent;

    error NotOperator();
    error UnknownRequest();

    constructor(address consumer_, address operator_) {
        consumer = consumer_;
        operator = operator_;
    }

    function setOperator(address op) external {
        if (msg.sender != operator) revert NotOperator();
        operator = op;
    }

    /// @inheritdoc IOutcomeVerifier
    function requestVerification(
        uint256 agentId,
        bytes32 taskId,
        bytes calldata /* parameters */
    ) external override returns (bytes32 requestId) {
        // Only the passport contract can open requests routed through it.
        require(msg.sender == consumer, "only consumer");
        requestId = keccak256(abi.encodePacked(agentId, taskId, nonce++));
        requestAgent[requestId] = agentId;
        emit VerificationRequested(requestId, agentId, taskId);
    }

    /// @notice Operator resolves a pending request. Simulates the DON callback.
    function resolve(bytes32 requestId, bool success) external {
        if (msg.sender != operator) revert NotOperator();
        uint256 agentId = requestAgent[requestId];
        if (agentId == 0) revert UnknownRequest();
        delete requestAgent[requestId];
        emit VerificationResolved(requestId, agentId, success);
        IVerificationConsumer(consumer).fulfillVerification(requestId, agentId, success);
    }
}
