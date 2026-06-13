// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @title ManagedTreasury (Commit 2 — skeleton)
/// @notice Sandbox environment in which an agent demonstrates treasury
///         behavior. It is OBSERVATIONAL, not enforcing: future verification
///         (Commit 3+) reads this treasury's history to decide whether the
///         agent respected the committed policy across an observation window.
///
/// @dev    Roles:
///           • owner    = the human SPONSOR (funds the treasury, commits policy)
///           • operator = the AGENT wallet (will act on the treasury in Commit 3)
///         This commit establishes only the state model, policy commitment,
///         custody, and access control. No rebalance/swap/withdraw, no
///         valuation, no aggregates, no TreasuryAction event — those are Commit 3+.
contract ManagedTreasury is Ownable {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Identity & assets (immutable bindings)
    // ---------------------------------------------------------------------

    /// @notice The AgentPassport agent this treasury belongs to.
    uint256 public immutable agentId;
    /// @notice The agent wallet authorized to operate the treasury (Commit 3+).
    address public immutable operator;
    /// @notice Stable asset (USDC-like).
    IERC20 public immutable stable;
    /// @notice Volatile asset (WETH-like).
    IERC20 public immutable volatileAsset;
    /// @notice Chainlink price feed used to value the volatile asset (Commit 3+).
    AggregatorV3Interface public immutable priceFeed;

    // ---------------------------------------------------------------------
    // Policy
    // ---------------------------------------------------------------------

    /// @notice The risk/stewardship policy the agent commits to before the
    ///         observation window opens. Verification later checks the treasury
    ///         trajectory against these bounds.
    struct Policy {
        uint16 minStableBps;     // minimum stable allocation, basis points (≤10000)
        uint256 capitalFloorUsd; // hard capital floor over the window
        uint16 minEndBps;        // end value ≥ startValue·minEndBps/10000 (≤10000)
        uint256 startValueUsd;   // committed starting portfolio value (reference)
        uint64 windowStart;      // observation window open (unix)
        uint64 windowEnd;        // observation window close (unix)
        uint64 startBlock;       // block at commit (history scan anchor)
    }

    Policy public policy;
    bool public committed;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event PolicyCommitted(
        uint256 indexed agentId,
        uint16 minStableBps,
        uint256 capitalFloorUsd,
        uint16 minEndBps,
        uint256 startValueUsd,
        uint64 windowStart,
        uint64 windowEnd,
        uint64 startBlock
    );
    event Funded(address indexed from, uint256 stableAmount, uint256 volatileAmount);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error AlreadyCommitted();
    error InvalidWindow();
    error InvalidBps();
    error InvalidStartValue();

    constructor(
        uint256 agentId_,
        address operator_,
        address stable_,
        address volatile_,
        address priceFeed_,
        address sponsor
    ) Ownable(sponsor) {
        require(operator_ != address(0), "operator=0");
        require(stable_ != address(0) && volatile_ != address(0), "token=0");
        require(priceFeed_ != address(0), "feed=0");
        agentId = agentId_;
        operator = operator_;
        stable = IERC20(stable_);
        volatileAsset = IERC20(volatile_);
        priceFeed = AggregatorV3Interface(priceFeed_);
    }

    // ---------------------------------------------------------------------
    // Custody (funding only; no withdraw in this commit by design)
    // ---------------------------------------------------------------------

    /// @notice Sponsor provisions the treasury with starting capital. Custody
    ///         lives in this contract. Withdraw is intentionally absent until
    ///         the action layer (Commit 3+).
    function fund(uint256 stableAmount, uint256 volatileAmount) external onlyOwner {
        if (stableAmount > 0) stable.safeTransferFrom(msg.sender, address(this), stableAmount);
        if (volatileAmount > 0) volatileAsset.safeTransferFrom(msg.sender, address(this), volatileAmount);
        emit Funded(msg.sender, stableAmount, volatileAmount);
    }

    // ---------------------------------------------------------------------
    // Policy commitment
    // ---------------------------------------------------------------------

    /// @notice Sponsor commits the policy and opens the observation window.
    ///         One-shot: the policy cannot be changed once committed (that is
    ///         what makes later verification a meaningful, fixed yardstick).
    function commitPolicy(
        uint16 minStableBps,
        uint256 capitalFloorUsd,
        uint16 minEndBps,
        uint256 startValueUsd,
        uint64 windowStart,
        uint64 windowEnd
    ) external onlyOwner {
        if (committed) revert AlreadyCommitted();
        if (minStableBps > 10_000 || minEndBps > 10_000) revert InvalidBps();
        if (windowEnd <= windowStart) revert InvalidWindow();
        if (startValueUsd == 0 || capitalFloorUsd > startValueUsd) revert InvalidStartValue();

        policy = Policy({
            minStableBps: minStableBps,
            capitalFloorUsd: capitalFloorUsd,
            minEndBps: minEndBps,
            startValueUsd: startValueUsd,
            windowStart: windowStart,
            windowEnd: windowEnd,
            startBlock: uint64(block.number)
        });
        committed = true;

        emit PolicyCommitted(
            agentId,
            minStableBps,
            capitalFloorUsd,
            minEndBps,
            startValueUsd,
            windowStart,
            windowEnd,
            uint64(block.number)
        );
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Full policy snapshot (struct getter convenience).
    function getPolicy() external view returns (Policy memory) {
        return policy;
    }

    /// @notice Current raw token custody held by the treasury.
    function balances() external view returns (uint256 stableBalance, uint256 volatileBalance) {
        return (stable.balanceOf(address(this)), volatileAsset.balanceOf(address(this)));
    }

    /// @notice True if `account` is the bound agent operator.
    function isOperator(address account) external view returns (bool) {
        return account == operator;
    }
}
