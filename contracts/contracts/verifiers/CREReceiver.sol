// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IOutcomeVerifier, IVerificationConsumer} from "../interfaces/IOutcomeVerifier.sol";

/// @title CREReceiver
/// @notice Verification backend for the Chainlink Runtime Environment (CRE),
///         replacing the (sunset) Chainlink Functions path WITHOUT changing the
///         protocol. It is a drop-in `IOutcomeVerifier`: AgentPassport calls
///         `requestVerification` exactly as before, and this contract returns
///         the verdict through the same `IVerificationConsumer.fulfillVerification`.
///
/// @dev    Two roles, one contract:
///           1. REQUEST side — AgentPassport's registered verifier. It records a
///              pending request and emits `WorkflowTrigger`, the EVM log a CRE
///              workflow subscribes to (carrying category + args).
///           2. VERDICT side — the CRE workflow's on-chain write target. Only the
///              authenticated `workflowSender` may deliver a verdict, which is
///              forwarded to AgentPassport.
///
///         Simulation-first: set `workflowSender` to an operator EOA to bridge
///         CRE-CLI simulation output on-chain today (no production access). In
///         production, set it to the CRE forwarder. No code change between modes.
///
///         To fall back during a demo, swap AgentPassport's verifier to
///         MockOutcomeVerifier — CREReceiver stays clean (verdicts only ever come
///         from the workflow sender).
contract CREReceiver is Ownable, IOutcomeVerifier {
    /// @notice The AgentPassport contract that consumes verification results.
    IVerificationConsumer public immutable consumer;

    /// @notice Authenticated identity allowed to deliver verdicts: an operator
    ///         EOA in simulation, or the CRE on-chain forwarder in production.
    address public workflowSender;

    struct Pending {
        uint256 agentId;
        bool exists;
    }

    mapping(bytes32 => Pending) public requests;
    uint256 public nonce;

    /// @notice EVM-log trigger for the CRE workflow. Carries everything the
    ///         workflow needs: the request id to settle, the agent, the
    ///         attestation category, the task id, and the decoded args.
    event WorkflowTrigger(
        bytes32 indexed requestId,
        uint256 indexed agentId,
        uint8 attType,
        bytes32 taskId,
        string[] args
    );
    event WorkflowSenderUpdated(address indexed workflowSender);

    error OnlyConsumer();
    error NotWorkflowSender();
    error UnknownRequest();

    constructor(address consumer_, address initialOwner) Ownable(initialOwner) {
        require(consumer_ != address(0), "consumer=0");
        consumer = IVerificationConsumer(consumer_);
    }

    modifier onlyConsumer() {
        if (msg.sender != address(consumer)) revert OnlyConsumer();
        _;
    }

    modifier onlyWorkflowSender() {
        if (workflowSender == address(0) || msg.sender != workflowSender) revert NotWorkflowSender();
        _;
    }

    /// @notice Set the authenticated verdict deliverer (operator EOA for
    ///         simulation, CRE forwarder for production). Until set, no verdict
    ///         is accepted.
    function setWorkflowSender(address sender) external onlyOwner {
        workflowSender = sender;
        emit WorkflowSenderUpdated(sender);
    }

    // --------------------------- request side ---------------------------

    /// @inheritdoc IOutcomeVerifier
    /// @param parameters abi.encode(uint8 attType, bytes innerArgs) as threaded
    ///        by AgentPassport; innerArgs is abi.encode(string[]).
    function requestVerification(
        uint256 agentId,
        bytes32 taskId,
        bytes calldata parameters
    ) external override onlyConsumer returns (bytes32 requestId) {
        (uint8 attType, bytes memory inner) = abi.decode(parameters, (uint8, bytes));
        string[] memory args = inner.length > 0 ? abi.decode(inner, (string[])) : new string[](0);

        requestId = keccak256(abi.encodePacked(agentId, taskId, nonce));
        nonce += 1;
        requests[requestId] = Pending({agentId: agentId, exists: true});

        emit VerificationRequested(requestId, agentId, taskId);
        emit WorkflowTrigger(requestId, agentId, attType, taskId, args);
    }

    // --------------------------- verdict side ---------------------------

    /// @notice Deliver a CRE workflow verdict. Authenticated to `workflowSender`;
    ///         one-shot per request (replay-protected); forwards to AgentPassport.
    function fulfillFromWorkflow(bytes32 requestId, bool success) external onlyWorkflowSender {
        Pending memory p = requests[requestId];
        if (!p.exists) revert UnknownRequest();
        delete requests[requestId];

        emit VerificationResolved(requestId, p.agentId, success);
        consumer.fulfillVerification(requestId, p.agentId, success);
    }
}
