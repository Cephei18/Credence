// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @title MockV3Aggregator
/// @notice DEMO/TEST ONLY Chainlink price feed. Implements the canonical
///         `AggregatorV3Interface` so ManagedTreasury can value its volatile
///         asset locally exactly as it would against a real Base Sepolia
///         ETH/USD feed. On a live network the real aggregator address is used
///         instead — this stand-in lets local tests/scripts control the price.
contract MockV3Aggregator is AggregatorV3Interface {
    uint8 public immutable override decimals;
    uint256 public constant override version = 0;
    string public constant DESCRIPTION = "MockV3Aggregator";

    uint80 public latestRoundId;
    mapping(uint80 => int256) public answers;
    mapping(uint80 => uint256) public timestamps;

    constructor(uint8 decimals_, int256 initialAnswer) {
        decimals = decimals_;
        _update(initialAnswer);
    }

    /// @notice Set a new price, advancing the round (simulates a feed update).
    function updateAnswer(int256 newAnswer) external {
        _update(newAnswer);
    }

    function _update(int256 newAnswer) internal {
        latestRoundId += 1;
        answers[latestRoundId] = newAnswer;
        timestamps[latestRoundId] = block.timestamp;
    }

    function description() external pure override returns (string memory) {
        return DESCRIPTION;
    }

    function getRoundData(uint80 _roundId)
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (_roundId, answers[_roundId], timestamps[_roundId], timestamps[_roundId], _roundId);
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (
            latestRoundId,
            answers[latestRoundId],
            timestamps[latestRoundId],
            timestamps[latestRoundId],
            latestRoundId
        );
    }
}
