// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title RightsResolver
/// @notice The dedicated rights-resolution layer: maps a set of *active
///         credentials* (as a bitmask) to the capabilities they confer. This
///         implements the new `Credential → Rights` model alongside the legacy
///         `Level → Rights` enforcement, which remains authoritative for MVP.
///
/// @dev    The bit indices MUST match `CredentialRegistry.CredentialType`:
///           0 Research · 1 Treasury · 2 Prediction · 3 Execution · 4 Governance
///         `spendTier` is an ordinal envelope class (0..3) that lines up with
///         AgentPassport's Level envelopes, so credential-derived rights and
///         level-derived rights stay consistent through the MVP bridge.
library RightsResolver {
    uint8 internal constant RESEARCH = 0;
    uint8 internal constant TREASURY = 1;
    uint8 internal constant PREDICTION = 2;
    uint8 internal constant EXECUTION = 3;
    uint8 internal constant GOVERNANCE = 4;

    struct ResolvedRights {
        uint256 spendTier;      // 0 none · 1 verified · 2 trusted · 3 autonomous
        bool canDelegate;
        bool treasuryAccess;
        bool governanceAccess;
        bool premiumAccess;     // research / premium API access
    }

    function has(uint256 mask, uint8 index) internal pure returns (bool) {
        return (mask >> index) & 1 == 1;
    }

    function bit(uint8 index) internal pure returns (uint256) {
        return uint256(1) << index;
    }

    /// @notice Resolve capabilities from an active-credential bitmask. Rights are
    ///         the union (logical OR) of what each held credential grants, with
    ///         spendTier taken as the maximum unlocked tier.
    function resolve(uint256 mask) internal pure returns (ResolvedRights memory r) {
        if (has(mask, PREDICTION) && r.spendTier < 1) r.spendTier = 1;
        if (has(mask, EXECUTION)) {
            r.canDelegate = true;
            if (r.spendTier < 2) r.spendTier = 2;
        }
        if (has(mask, GOVERNANCE)) r.governanceAccess = true;
        if (has(mask, TREASURY)) {
            r.treasuryAccess = true;
            r.spendTier = 3;
        }
        if (has(mask, RESEARCH)) r.premiumAccess = true;
    }
}
