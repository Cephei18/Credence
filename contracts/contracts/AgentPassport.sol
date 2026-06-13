// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IOutcomeVerifier, IVerificationConsumer} from "./interfaces/IOutcomeVerifier.sol";
import {IPassportNameRegistry} from "./interfaces/IPassportNameRegistry.sol";

/// @title AgentPassport
/// @author Agent Passport
/// @notice Credential & rights infrastructure for autonomous agents. Agents do
///         not receive authority on creation; their authorizing human/org
///         PRINCIPAL earns a progressively wider, enforceable delegation
///         envelope as the agent accumulates *independently verified* outcomes.
///
/// @dev    This contract is the "constitution" + the enforcement chokepoint.
///         Key hardening decisions (see WHITEPAPER / SMART_CONTRACT_SPEC):
///           1. SYBIL ANCHOR: rights are gated by a principal who posts a
///              slashable stake. Spawning agents is cheap; staking is not.
///           2. INDEPENDENT VERIFICATION: outcomes are resolved only by a
///              trusted IOutcomeVerifier, never self-reported.
///           3. SOULBOUND: agent credentials and passport names are
///              non-transferable, so earned authority can't be sold/rented.
///           4. ENFORCEMENT: spend authority is checked here in `attemptAction`,
///              so the passport is a gate, not a cosmetic badge.
///           5. DECAY: credentials go stale; leveling up requires a *recent*
///              verified outcome, and stale credentials lose live rights.
///           6. SLASHING: violations burn stake and can revoke the passport,
///              aligning the principal's capital with the agent's behavior.
contract AgentPassport is Ownable, ReentrancyGuard, IVerificationConsumer {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /// @notice Credential tiers. Higher tiers unlock wider delegation envelopes.
    enum Level {
        Unverified, // 0
        Verified,   // 1
        Trusted,    // 2
        Autonomous  // 3
    }

    /// @notice The human/org that authorized an agent. The unit of Sybil
    ///         resistance and liability — stake lives here, not on the agent.
    struct Principal {
        bool registered;
        uint256 stake;       // slashable bond backing all of this principal's agents
        uint256 agentCount;
        uint256 slashed;     // cumulative stake burned for violations
    }

    /// @notice An agent is a revocable delegation from a principal, with a
    ///         soulbound behavioral track record.
    struct Agent {
        address principal;     // who authorized this agent (Sybil/liability anchor)
        address wallet;        // the agent's operating wallet (Privy embedded wallet)
        Level level;
        uint64 verifiedCount;  // count of independently verified successful outcomes
        uint64 violations;     // failed verifications / policy breaches
        uint64 lastVerifiedAt; // timestamp of most recent success (drives decay)
        uint64 epochStart;     // start of the current spend epoch
        uint256 spentInEpoch;  // amount spent in the current epoch (enforcement)
        bool paused;           // emergency stop for this agent
        bytes32 passportNode;  // ENS node once a passport name is issued (0 = none)
    }

    /// @notice The delegation envelope derived purely from level. Rights are a
    ///         function of credential, never stored per-agent mutable state.
    struct Rights {
        uint256 spendLimitPerEpoch; // max spend the agent may authorize per epoch
        bool canDelegate;           // may sub-delegate to other agents
        bool treasuryAccess;        // may touch principal treasury flows
        bool governanceAccess;      // may participate in governance
    }

    // ---------------------------------------------------------------------
    // Config
    // ---------------------------------------------------------------------

    uint256 public constant EPOCH = 1 days;

    /// @notice A verified outcome older than this no longer counts as "live"
    ///         and cannot be used to justify a level-up (credential decay).
    uint256 public verificationTtl = 30 days;

    /// @notice Minimum stake (wei) a principal must hold to operate agents at
    ///         each level index. Index 0 (Unverified) is the floor to register.
    uint256[4] public minStakeForLevel = [
        0.001 ether, // Unverified: nominal anti-spam bond
        0.01 ether,  // Verified
        0.05 ether,  // Trusted (delegation)
        0.2 ether    // Autonomous (treasury) — stake scales with blast radius
    ];

    /// @notice Verified-outcome count required to reach each level index.
    uint64[4] public verifiedNeededForLevel = [0, 1, 3, 6];

    /// @notice Level index at/above which a passport name becomes eligible.
    Level public passportEligibleAt = Level.Verified;

    /// @notice Stake burned per violation (capped at remaining stake).
    uint256 public slashPerViolation = 0.005 ether;

    IOutcomeVerifier public verifier;
    IPassportNameRegistry public nameRegistry;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    mapping(address => Principal) public principals;
    mapping(uint256 => Agent) public agents;
    uint256 public nextAgentId = 1;

    /// @notice Open verification requests -> agent id (set by us, cleared on fulfill).
    mapping(bytes32 => uint256) public pendingVerification;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event PrincipalRegistered(address indexed principal, uint256 stake);
    event StakeAdded(address indexed principal, uint256 amount, uint256 total);
    event StakeWithdrawn(address indexed principal, uint256 amount, uint256 remaining);
    event AgentRegistered(uint256 indexed agentId, address indexed principal, address wallet);
    event ActionAttempted(uint256 indexed agentId, uint256 amount, bool allowed, string reason);
    event VerificationRequested(uint256 indexed agentId, bytes32 indexed requestId, bytes32 taskId);
    event OutcomeRecorded(uint256 indexed agentId, bool success, uint64 verifiedCount, uint64 violations);
    event LeveledUp(uint256 indexed agentId, Level from, Level to);
    event PassportIssued(uint256 indexed agentId, bytes32 node, string label);
    event AgentPaused(uint256 indexed agentId, bool paused);
    event RightsRevoked(uint256 indexed agentId, Level from, Level to);
    event Slashed(address indexed principal, uint256 indexed agentId, uint256 amount);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error NotRegistered();
    error AlreadyRegistered();
    error InsufficientStake(uint256 required, uint256 have);
    error NotPrincipal();
    error NotVerifier();
    error UnknownAgent();
    error AgentIsPaused();
    error NothingToLevel();
    error StaleCredential();
    error NotEligibleForPassport();
    error PassportAlreadyIssued();
    error StakeLocked();

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ---------------------------------------------------------------------
    // Principal lifecycle (the Sybil/liability anchor)
    // ---------------------------------------------------------------------

    /// @notice Register the caller as a principal by posting the floor stake.
    function registerPrincipal() external payable {
        Principal storage p = principals[msg.sender];
        if (p.registered) revert AlreadyRegistered();
        if (msg.value < minStakeForLevel[0]) {
            revert InsufficientStake(minStakeForLevel[0], msg.value);
        }
        p.registered = true;
        p.stake = msg.value;
        emit PrincipalRegistered(msg.sender, msg.value);
    }

    /// @notice Top up stake to unlock higher-level agents.
    function addStake() external payable {
        Principal storage p = principals[msg.sender];
        if (!p.registered) revert NotRegistered();
        p.stake += msg.value;
        emit StakeAdded(msg.sender, msg.value, p.stake);
    }

    /// @notice Withdraw stake down to the floor required by the principal's
    ///         highest active agent level. Prevents pulling collateral out from
    ///         under outstanding high-trust delegations.
    function withdrawStake(uint256 amount) external nonReentrant {
        Principal storage p = principals[msg.sender];
        if (!p.registered) revert NotRegistered();
        uint256 required = _requiredStakeFloor(msg.sender);
        if (p.stake < amount || p.stake - amount < required) revert StakeLocked();
        p.stake -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        emit StakeWithdrawn(msg.sender, amount, p.stake);
    }

    // ---------------------------------------------------------------------
    // Agent lifecycle
    // ---------------------------------------------------------------------

    /// @notice Authorize a new agent. Starts at Level 0 with a tiny spend
    ///         envelope and no delegation/treasury rights.
    /// @param wallet The agent's operating (Privy embedded) wallet.
    function registerAgent(address wallet) external returns (uint256 agentId) {
        Principal storage p = principals[msg.sender];
        if (!p.registered) revert NotRegistered();
        require(wallet != address(0), "zero wallet");

        agentId = nextAgentId++;
        Agent storage a = agents[agentId];
        a.principal = msg.sender;
        a.wallet = wallet;
        a.level = Level.Unverified;
        a.epochStart = uint64(block.timestamp);
        p.agentCount += 1;

        emit AgentRegistered(agentId, msg.sender, wallet);
    }

    // ---------------------------------------------------------------------
    // Enforcement chokepoint
    // ---------------------------------------------------------------------

    /// @notice The gate every privileged agent action must pass through. Returns
    ///         true and records spend if the action is within the agent's live
    ///         delegation envelope; reverts otherwise. This is what makes the
    ///         passport an enforcer rather than a badge.
    /// @param agentId The acting agent.
    /// @param amount  The value the action would spend/commit (wei-denominated).
    function attemptAction(uint256 agentId, uint256 amount)
        external
        returns (bool allowed)
    {
        Agent storage a = agents[agentId];
        if (a.principal == address(0)) revert UnknownAgent();
        if (a.paused) revert AgentIsPaused();

        // Roll the spend epoch forward if needed.
        if (block.timestamp >= a.epochStart + EPOCH) {
            a.epochStart = uint64(block.timestamp);
            a.spentInEpoch = 0;
        }

        Rights memory r = _rightsOf(a);

        // Stale credential => collapse to Unverified envelope (decay enforcement).
        if (!_credentialLive(a)) {
            r = _rightsForLevel(Level.Unverified);
        }

        if (a.spentInEpoch + amount > r.spendLimitPerEpoch) {
            emit ActionAttempted(agentId, amount, false, "spend limit exceeded");
            revert InsufficientStake(r.spendLimitPerEpoch, a.spentInEpoch + amount);
        }

        a.spentInEpoch += amount;
        emit ActionAttempted(agentId, amount, true, "ok");
        return true;
    }

    // ---------------------------------------------------------------------
    // Verification (independent ground truth)
    // ---------------------------------------------------------------------

    /// @notice Ask the trusted verifier to resolve an agent's claimed outcome.
    ///         Anyone may trigger verification; only the verifier can resolve it.
    function requestVerification(
        uint256 agentId,
        bytes32 taskId,
        bytes calldata parameters
    ) external returns (bytes32 requestId) {
        Agent storage a = agents[agentId];
        if (a.principal == address(0)) revert UnknownAgent();
        require(address(verifier) != address(0), "no verifier");

        requestId = verifier.requestVerification(agentId, taskId, parameters);
        pendingVerification[requestId] = agentId;
        emit VerificationRequested(agentId, requestId, taskId);
    }

    /// @inheritdoc IVerificationConsumer
    function fulfillVerification(bytes32 requestId, uint256 agentId, bool success)
        external
        override
    {
        if (msg.sender != address(verifier)) revert NotVerifier();
        if (pendingVerification[requestId] != agentId) revert UnknownAgent();
        delete pendingVerification[requestId];

        Agent storage a = agents[agentId];
        if (success) {
            a.verifiedCount += 1;
            a.lastVerifiedAt = uint64(block.timestamp);
        } else {
            a.violations += 1;
            _slash(a.principal, agentId);
            // A failed/dishonest outcome can knock a high-trust agent back down.
            if (a.level > Level.Unverified) {
                Level from = a.level;
                a.level = Level(uint8(a.level) - 1);
                emit RightsRevoked(agentId, from, a.level);
            }
        }
        emit OutcomeRecorded(agentId, success, a.verifiedCount, a.violations);
    }

    // ---------------------------------------------------------------------
    // Progression
    // ---------------------------------------------------------------------

    /// @notice Promote an agent one level if it has (a) enough verified
    ///         outcomes, (b) a *recent* verified outcome (not decayed), and
    ///         (c) a principal stake covering the new level. Permissionless:
    ///         anyone can poke it, the checks are objective.
    function levelUp(uint256 agentId) external {
        Agent storage a = agents[agentId];
        if (a.principal == address(0)) revert UnknownAgent();
        if (a.paused) revert AgentIsPaused();
        if (a.level == Level.Autonomous) revert NothingToLevel();

        Level next = Level(uint8(a.level) + 1);
        uint8 ni = uint8(next);

        if (a.verifiedCount < verifiedNeededForLevel[ni]) revert NothingToLevel();
        if (!_credentialLive(a)) revert StaleCredential();
        uint256 need = minStakeForLevel[ni];
        uint256 have = principals[a.principal].stake;
        if (have < need) revert InsufficientStake(need, have);

        Level from = a.level;
        a.level = next;
        emit LeveledUp(agentId, from, next);
    }

    /// @notice Issue the portable passport name once the agent is eligible.
    ///         Soulbound to the agent wallet via the name registry.
    function issuePassport(uint256 agentId, string calldata label) external {
        Agent storage a = agents[agentId];
        if (a.principal == address(0)) revert UnknownAgent();
        if (uint8(a.level) < uint8(passportEligibleAt)) revert NotEligibleForPassport();
        if (a.passportNode != bytes32(0)) revert PassportAlreadyIssued();
        require(address(nameRegistry) != address(0), "no registry");

        bytes32 node = nameRegistry.issue(agentId, a.wallet, label);
        a.passportNode = node;
        emit PassportIssued(agentId, node, label);
    }

    // ---------------------------------------------------------------------
    // Governance / safety
    // ---------------------------------------------------------------------

    /// @notice Emergency stop / resume for a single agent. Callable by the
    ///         contract owner (protocol guardian) or the agent's principal.
    function pauseAgent(uint256 agentId, bool paused_) external {
        Agent storage a = agents[agentId];
        if (a.principal == address(0)) revert UnknownAgent();
        if (msg.sender != owner() && msg.sender != a.principal) revert NotPrincipal();
        a.paused = paused_;
        emit AgentPaused(agentId, paused_);
    }

    /// @notice Forcibly downgrade an agent's level (guardian action for abuse
    ///         that isn't captured by automated verification). Revokes the
    ///         passport name if the agent drops below eligibility.
    function revokeRights(uint256 agentId, Level to) external onlyOwner {
        Agent storage a = agents[agentId];
        if (a.principal == address(0)) revert UnknownAgent();
        require(uint8(to) < uint8(a.level), "not a downgrade");
        Level from = a.level;
        a.level = to;
        if (uint8(to) < uint8(passportEligibleAt) && a.passportNode != bytes32(0)) {
            nameRegistry.revoke(agentId);
            a.passportNode = bytes32(0);
        }
        emit RightsRevoked(agentId, from, to);
    }

    // ---------------------------------------------------------------------
    // Admin config
    // ---------------------------------------------------------------------

    function setVerifier(address v) external onlyOwner {
        verifier = IOutcomeVerifier(v);
    }

    function setNameRegistry(address r) external onlyOwner {
        nameRegistry = IPassportNameRegistry(r);
    }

    function setVerificationTtl(uint256 ttl) external onlyOwner {
        verificationTtl = ttl;
    }

    function setSlashPerViolation(uint256 amount) external onlyOwner {
        slashPerViolation = amount;
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice The live delegation envelope for an agent (after decay).
    function getRights(uint256 agentId) external view returns (Rights memory) {
        Agent storage a = agents[agentId];
        if (a.principal == address(0)) revert UnknownAgent();
        if (!_credentialLive(a)) return _rightsForLevel(Level.Unverified);
        return _rightsOf(a);
    }

    /// @notice Full credential snapshot for an agent.
    function getCredential(uint256 agentId)
        external
        view
        returns (
            Level level,
            uint64 verifiedCount,
            uint64 violations,
            bool live,
            bool hasPassport,
            uint256 spentInEpoch,
            uint256 spendLimit
        )
    {
        Agent storage a = agents[agentId];
        if (a.principal == address(0)) revert UnknownAgent();
        Rights memory r = _credentialLive(a) ? _rightsOf(a) : _rightsForLevel(Level.Unverified);
        return (
            a.level,
            a.verifiedCount,
            a.violations,
            _credentialLive(a),
            a.passportNode != bytes32(0),
            a.spentInEpoch,
            r.spendLimitPerEpoch
        );
    }

    /// @notice True if the agent's most recent success is within the TTL window.
    ///         Level 0 agents are always "live" (nothing to decay).
    function isCredentialLive(uint256 agentId) external view returns (bool) {
        return _credentialLive(agents[agentId]);
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _rightsOf(Agent storage a) internal view returns (Rights memory) {
        return _rightsForLevel(a.level);
    }

    function _rightsForLevel(Level level) internal pure returns (Rights memory r) {
        if (level == Level.Unverified) {
            return Rights({spendLimitPerEpoch: 0.0005 ether, canDelegate: false, treasuryAccess: false, governanceAccess: false});
        } else if (level == Level.Verified) {
            return Rights({spendLimitPerEpoch: 0.05 ether, canDelegate: false, treasuryAccess: false, governanceAccess: false});
        } else if (level == Level.Trusted) {
            return Rights({spendLimitPerEpoch: 0.5 ether, canDelegate: true, treasuryAccess: false, governanceAccess: true});
        } else {
            return Rights({spendLimitPerEpoch: 5 ether, canDelegate: true, treasuryAccess: true, governanceAccess: true});
        }
    }

    function _credentialLive(Agent storage a) internal view returns (bool) {
        if (a.level == Level.Unverified) return true;
        return block.timestamp <= uint256(a.lastVerifiedAt) + verificationTtl;
    }

    /// @notice The stake floor a principal must keep, set by its highest-level agent.
    /// @dev O(agentCount) is fine for the demo; production would track a max
    ///      incrementally. Capped scan keeps it bounded.
    function _requiredStakeFloor(address principal) internal view returns (uint256 floor) {
        floor = minStakeForLevel[0];
        uint256 scanned;
        for (uint256 id = 1; id < nextAgentId && scanned < 256; id++) {
            Agent storage a = agents[id];
            if (a.principal == principal) {
                scanned++;
                uint256 need = minStakeForLevel[uint8(a.level)];
                if (need > floor) floor = need;
            }
        }
    }

    function _slash(address principal, uint256 agentId) internal {
        Principal storage p = principals[principal];
        uint256 amount = slashPerViolation;
        if (amount > p.stake) amount = p.stake;
        if (amount == 0) return;
        p.stake -= amount;
        p.slashed += amount;
        // Burn to the protocol owner (guardian treasury). Pull-free, bounded.
        (bool ok, ) = owner().call{value: amount}("");
        ok; // ignore failure; stake is already debited to prevent griefing
        emit Slashed(principal, agentId, amount);
    }
}
