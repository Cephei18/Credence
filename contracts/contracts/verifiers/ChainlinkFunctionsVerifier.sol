// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FunctionsClient} from "@chainlink/contracts/src/v0.8/functions/v1_0_0/FunctionsClient.sol";
import {FunctionsRequest} from "@chainlink/contracts/src/v0.8/functions/v1_0_0/libraries/FunctionsRequest.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IOutcomeVerifier, IVerificationConsumer} from "../interfaces/IOutcomeVerifier.sol";

/// @title ChainlinkFunctionsVerifier
/// @notice Production verifier. Resolves an agent's claimed outcome against
///         INDEPENDENT ground truth using Chainlink Functions: a JavaScript
///         source runs on the decentralized oracle network (DON), hits a neutral
///         data source (price feed API, sports/election result, on-chain event),
///         and returns a boolean the agent cannot forge.
///
/// @dev    This directly answers protocol critique #2 — outcomes are never
///         self-reported. The DON is the trust root. The `source` JS and the
///         `parameters` (args) define exactly what "success" means for a task;
///         keep them committed/audited so judges and users can inspect the
///         verification logic.
contract ChainlinkFunctionsVerifier is FunctionsClient, Ownable, IOutcomeVerifier {
    using FunctionsRequest for FunctionsRequest.Request;

    /// @notice The AgentPassport contract that consumes verification results.
    IVerificationConsumer public immutable consumer;

    /// @notice DON subscription that pays for requests.
    uint64 public subscriptionId;
    /// @notice Gas limit for the fulfillment callback.
    uint32 public callbackGasLimit = 300_000;
    /// @notice DON id (e.g. base-sepolia: "fun-base-sepolia-1").
    bytes32 public donId;
    /// @notice The audited JS source executed on the DON.
    string public source;

    struct Pending {
        uint256 agentId;
        uint8 attType;   // attestation category being evaluated
        bool exists;
    }

    /// @notice Human-readable category names indexed by attestation type, passed
    ///         to the DON as the first argument so the source evaluates (and can
    ///         echo) the exact category requested.
    string[6] public categoryNames = ["research", "treasury", "prediction", "execution", "governance", "risk"];

    mapping(bytes32 => Pending) public requests; // Chainlink requestId => agent

    error OnlyConsumer();
    error UnknownRequest();

    constructor(
        address router,
        address consumer_,
        bytes32 donId_,
        uint64 subscriptionId_,
        address initialOwner
    ) FunctionsClient(router) Ownable(initialOwner) {
        consumer = IVerificationConsumer(consumer_);
        donId = donId_;
        subscriptionId = subscriptionId_;
    }

    // --------------------------- admin ---------------------------

    function setSource(string calldata source_) external onlyOwner {
        source = source_;
    }

    function setConfig(uint64 sub, uint32 gas, bytes32 don) external onlyOwner {
        subscriptionId = sub;
        callbackGasLimit = gas;
        donId = don;
    }

    // --------------------------- verify ---------------------------

    /// @inheritdoc IOutcomeVerifier
    /// @param parameters ABI-encoded string[] of args forwarded to the DON
    ///        source (e.g. ["ETH", "up", "<predictionTimestamp>"]).
    function requestVerification(
        uint256 agentId,
        bytes32 taskId,
        bytes calldata parameters
    ) external override returns (bytes32 requestId) {
        if (msg.sender != address(consumer)) revert OnlyConsumer();

        // AgentPassport threads the category: parameters = abi.encode(uint8 attType, bytes innerArgs).
        (uint8 attType, bytes memory inner) = abi.decode(parameters, (uint8, bytes));
        string[] memory innerArgs = inner.length > 0 ? abi.decode(inner, (string[])) : new string[](0);

        FunctionsRequest.Request memory req;
        req.initializeRequestForInlineJavaScript(source);

        // Pass the category as args[0] so the DON source evaluates exactly it.
        string[] memory args = new string[](innerArgs.length + 1);
        args[0] = attType < 6 ? categoryNames[attType] : "unknown";
        for (uint256 i = 0; i < innerArgs.length; i++) {
            args[i + 1] = innerArgs[i];
        }
        req.setArgs(args);

        requestId = _sendRequest(
            req.encodeCBOR(),
            subscriptionId,
            callbackGasLimit,
            donId
        );
        requests[requestId] = Pending({agentId: agentId, attType: attType, exists: true});
        emit VerificationRequested(requestId, agentId, taskId);
    }

    /// @notice Chainlink DON callback. Decodes the boolean outcome and forwards
    ///         it to the passport. A non-empty `err` is treated as failure.
    function fulfillRequest(
        bytes32 requestId,
        bytes memory response,
        bytes memory err
    ) internal override {
        Pending memory p = requests[requestId];
        if (!p.exists) revert UnknownRequest();
        delete requests[requestId];

        bool success = err.length == 0 && response.length > 0 && response[response.length - 1] != 0x00;
        emit VerificationResolved(requestId, p.agentId, success);
        consumer.fulfillVerification(requestId, p.agentId, success);
    }
}
