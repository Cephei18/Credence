// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @notice Sandbox asset capability: ManagedTreasury simulates oracle-priced
///         swaps by burning the in-asset and minting the out-asset. Only the
///         mock sandbox tokens implement this — the treasury is a demo
///         environment, not a production vault.
interface ISandboxToken {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
}

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
    /// @notice Chainlink price feed used to value the volatile asset.
    AggregatorV3Interface public immutable priceFeed;

    /// @dev Fixed-point units captured at construction. USD is expressed in the
    ///      feed's decimals so the price needs no rescaling.
    uint256 public immutable STABLE_UNIT;   // 10**stableDecimals
    uint256 public immutable VOLATILE_UNIT; // 10**volatileDecimals
    uint256 public immutable USD_UNIT;      // 10**feedDecimals

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

    /// @notice Type of state-changing action recorded in TreasuryAction.
    enum ActionType { Rebalance, Swap, Withdraw }

    /// @notice Running worst-case aggregates over the treasury's lifetime,
    ///         updated on every action. `worstStableBps` is the lowest stable
    ///         allocation ever observed; `worstValueUsd` the lowest total value.
    ///         These let a future verifier confirm compliance cheaply, and back
    ///         the off-chain log scan as an on-chain cross-check.
    uint16 public worstStableBps;
    uint256 public worstValueUsd;

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

    /// @notice Emitted on every state-changing action — the immutable audit
    ///         trail a future DON reconstructs compliance from.
    event TreasuryAction(
        uint256 indexed agentId,
        uint8 actionType,
        uint256 stableBalance,
        uint256 volatileBalance,
        uint256 ethUsdPrice,
        uint256 totalValueUsd,
        uint16 stableBps,
        uint64 timestamp
    );

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error AlreadyCommitted();
    error InvalidWindow();
    error InvalidBps();
    error InvalidStartValue();
    error NotOperator();
    error NotCommitted();
    error InvalidAmount();
    error BadPrice();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

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

        STABLE_UNIT = 10 ** IERC20Metadata(stable_).decimals();
        VOLATILE_UNIT = 10 ** IERC20Metadata(volatile_).decimals();
        USD_UNIT = 10 ** AggregatorV3Interface(priceFeed_).decimals();

        // Seed min-trackers to "best case" so the first action sets real lows.
        worstStableBps = 10_000;
        worstValueUsd = type(uint256).max;
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
    // Behavior layer (operator actions — observational, not enforcing)
    // ---------------------------------------------------------------------
    // Actions allow BOTH compliant and non-compliant behavior by design. The
    // protocol observes; it does not block a breach. Credentials are later
    // earned (or denied) from this recorded trajectory.

    /// @notice Reallocate the portfolio to a target stable ratio at the live
    ///         oracle price (total value preserved, no slippage — sandbox).
    function rebalance(uint16 targetStableBps) external onlyOperator {
        if (!committed) revert NotCommitted();
        if (targetStableBps > 10_000) revert InvalidBps();

        (uint256 totalUsd, , uint256 price) = _coreValuation();
        uint256 targetStableUsd = (totalUsd * targetStableBps) / 10_000;
        uint256 curStableUsd = (stable.balanceOf(address(this)) * USD_UNIT) / STABLE_UNIT;

        if (targetStableUsd > curStableUsd) {
            uint256 deltaUsd = targetStableUsd - curStableUsd;
            ISandboxToken(address(volatileAsset)).burn(address(this), (deltaUsd * VOLATILE_UNIT) / price);
            ISandboxToken(address(stable)).mint(address(this), (deltaUsd * STABLE_UNIT) / USD_UNIT);
        } else if (curStableUsd > targetStableUsd) {
            uint256 deltaUsd = curStableUsd - targetStableUsd;
            ISandboxToken(address(stable)).burn(address(this), (deltaUsd * STABLE_UNIT) / USD_UNIT);
            ISandboxToken(address(volatileAsset)).mint(address(this), (deltaUsd * VOLATILE_UNIT) / price);
        }
        _record(ActionType.Rebalance);
    }

    /// @notice Convert `amountIn` of one leg into the other at the oracle price.
    function swap(bool stableToVolatile, uint256 amountIn) external onlyOperator {
        if (!committed) revert NotCommitted();
        if (amountIn == 0) revert InvalidAmount();
        uint256 price = _price();

        if (stableToVolatile) {
            ISandboxToken(address(stable)).burn(address(this), amountIn);
            uint256 usd = (amountIn * USD_UNIT) / STABLE_UNIT;
            ISandboxToken(address(volatileAsset)).mint(address(this), (usd * VOLATILE_UNIT) / price);
        } else {
            ISandboxToken(address(volatileAsset)).burn(address(this), amountIn);
            uint256 usd = (amountIn * price) / VOLATILE_UNIT;
            ISandboxToken(address(stable)).mint(address(this), (usd * STABLE_UNIT) / USD_UNIT);
        }
        _record(ActionType.Swap);
    }

    /// @notice Operator removes capital from the managed position (real token
    ///         transfer). Reduces total value — can breach the capital floor /
    ///         drawdown bound, which is exactly what verification must catch.
    function withdraw(uint256 stableAmount, uint256 volatileAmount) external onlyOperator {
        if (!committed) revert NotCommitted();
        if (stableAmount == 0 && volatileAmount == 0) revert InvalidAmount();
        if (stableAmount > 0) stable.safeTransfer(operator, stableAmount);
        if (volatileAmount > 0) volatileAsset.safeTransfer(operator, volatileAmount);
        _record(ActionType.Withdraw);
    }

    // ---------------------------------------------------------------------
    // Valuation + aggregates (internal)
    // ---------------------------------------------------------------------

    function _price() internal view returns (uint256) {
        (, int256 answer, , , ) = priceFeed.latestRoundData();
        if (answer <= 0) revert BadPrice();
        return uint256(answer);
    }

    /// @dev Portfolio valuation in feed-decimals USD; stable assumed $1.
    function _coreValuation() internal view returns (uint256 totalUsd, uint16 stableBps, uint256 price) {
        price = _price();
        uint256 sUsd = (stable.balanceOf(address(this)) * USD_UNIT) / STABLE_UNIT;
        uint256 vUsd = (volatileAsset.balanceOf(address(this)) * price) / VOLATILE_UNIT;
        totalUsd = sUsd + vUsd;
        stableBps = totalUsd == 0 ? 10_000 : uint16((sUsd * 10_000) / totalUsd);
    }

    function _record(ActionType actionType) internal {
        (uint256 totalUsd, uint16 stableBps, uint256 price) = _coreValuation();
        if (stableBps < worstStableBps) worstStableBps = stableBps;
        if (totalUsd < worstValueUsd) worstValueUsd = totalUsd;
        emit TreasuryAction(
            agentId,
            uint8(actionType),
            stable.balanceOf(address(this)),
            volatileAsset.balanceOf(address(this)),
            price,
            totalUsd,
            stableBps,
            uint64(block.timestamp)
        );
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Full policy snapshot (struct getter convenience).
    function getPolicy() external view returns (Policy memory) {
        return policy;
    }

    /// @notice Current portfolio valuation in feed-decimals USD.
    function currentValuation()
        external
        view
        returns (uint256 stableUsd, uint256 volatileUsd, uint256 totalUsd, uint16 stableBps, uint256 price)
    {
        price = _price();
        stableUsd = (stable.balanceOf(address(this)) * USD_UNIT) / STABLE_UNIT;
        volatileUsd = (volatileAsset.balanceOf(address(this)) * price) / VOLATILE_UNIT;
        totalUsd = stableUsd + volatileUsd;
        stableBps = totalUsd == 0 ? 10_000 : uint16((stableUsd * 10_000) / totalUsd);
    }

    /// @notice Current stable allocation ratio (basis points).
    function currentStableBps() external view returns (uint16 stableBps) {
        (, stableBps, ) = _coreValuation();
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
