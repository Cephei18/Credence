// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPassportNameRegistry} from "./interfaces/IPassportNameRegistry.sol";

/// @title PassportNameRegistry
/// @notice Soulbound, ENS-compatible subname issuer for agent passports under a
///         parent node (e.g. `agentpassport.eth`). Issued names are the portable
///         credential layer described in the whitepaper.
///
/// @dev    Hardening (critique #3): names are NON-TRANSFERABLE and REVOCABLE.
///         There is deliberately no transfer/approve surface — a passport is an
///         earned credential, not a tradable asset. `node` is computed with the
///         standard ENS namehash so the same label resolves identically if/when
///         this registry is fronted by an ENS L2 resolver (Durin) or a mainnet
///         NameWrapper-controlled parent. Only the controller (the AgentPassport
///         contract) may issue or revoke.
contract PassportNameRegistry is Ownable, IPassportNameRegistry {
    /// @notice The parent ENS node, e.g. namehash("agentpassport.eth").
    bytes32 public immutable parentNode;

    /// @notice The AgentPassport contract authorized to issue/revoke names.
    address public controller;

    struct Record {
        bytes32 node;
        address owner; // soulbound to this address (the agent wallet)
        string name;   // fully-qualified name, e.g. "trusted-research.agentpassport.eth"
        bool active;
    }

    mapping(uint256 => Record) public records;     // agentId => record
    mapping(bytes32 => uint256) public nodeToAgent; // node => agentId (label uniqueness)

    error NotController();
    error LabelTaken();
    error NoRecord();

    modifier onlyController() {
        if (msg.sender != controller) revert NotController();
        _;
    }

    constructor(address initialOwner, bytes32 parentNode_)
        Ownable(initialOwner)
    {
        parentNode = parentNode_;
    }

    function setController(address c) external onlyOwner {
        controller = c;
    }

    /// @inheritdoc IPassportNameRegistry
    function issue(uint256 agentId, address owner, string calldata label)
        external
        override
        onlyController
        returns (bytes32 node)
    {
        bytes32 labelHash = keccak256(bytes(label));
        node = keccak256(abi.encodePacked(parentNode, labelHash));
        if (nodeToAgent[node] != 0) revert LabelTaken();

        records[agentId] = Record({
            node: node,
            owner: owner,
            name: string(abi.encodePacked(label, ".agentpassport.eth")),
            active: true
        });
        nodeToAgent[node] = agentId;
        emit PassportIssued(agentId, node, label);
    }

    /// @inheritdoc IPassportNameRegistry
    function revoke(uint256 agentId) external override onlyController {
        Record storage r = records[agentId];
        if (!r.active) revert NoRecord();
        r.active = false;
        delete nodeToAgent[r.node];
        emit PassportRevoked(agentId, r.node);
    }

    /// @inheritdoc IPassportNameRegistry
    function nodeOf(uint256 agentId) external view override returns (bytes32) {
        Record storage r = records[agentId];
        return r.active ? r.node : bytes32(0);
    }

    /// @notice Forward resolution: agentId => fully-qualified name.
    function nameOf(uint256 agentId) external view returns (string memory) {
        Record storage r = records[agentId];
        return r.active ? r.name : "";
    }

    /// @notice ENS-style owner resolution for a node (returns 0 if revoked).
    function ownerOfNode(bytes32 node) external view returns (address) {
        uint256 agentId = nodeToAgent[node];
        if (agentId == 0) return address(0);
        return records[agentId].owner;
    }
}
