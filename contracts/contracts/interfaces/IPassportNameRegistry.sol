// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IPassportNameRegistry
/// @notice Issues the portable, human-readable credential layer (ENS-style
///         subnames) once an agent crosses the eligibility threshold.
///
/// @dev    Design note (protocol critique #3): the name is a CREDENTIAL, not an
///         asset. Issued names MUST be soulbound (non-transferable) and
///         revocable, so earned authority cannot be sold or rented. In
///         production this is fronted by an ENS L2 resolver (Durin-style) or a
///         mainnet NameWrapper-controlled parent; for the hackathon a
///         self-contained soulbound registry stands in.
interface IPassportNameRegistry {
    event PassportIssued(uint256 indexed agentId, bytes32 indexed node, string name);
    event PassportRevoked(uint256 indexed agentId, bytes32 indexed node);

    /// @notice Issue a soulbound subname (e.g. "trusted-research") under the
    ///         passport parent ("*.agentpassport.eth").
    /// @return node The ENS namehash node of the issued name.
    function issue(uint256 agentId, address owner, string calldata label) external returns (bytes32 node);

    /// @notice Revoke a previously issued passport name (on slash / violation).
    function revoke(uint256 agentId) external;

    /// @notice Resolve an agent id to its issued node (0 if none).
    function nodeOf(uint256 agentId) external view returns (bytes32);
}
