// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockERC20
/// @notice DEMO/TEST ONLY sandbox token for the ManagedTreasury environment.
///         Used to model a stable (USDC-like, 6 decimals) and a volatile
///         (WETH-like, 18 decimals) asset. Mint is open by design so demo
///         scripts and tests can provision balances freely. Never deploy to a
///         network where this token is expected to have real value.
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_)
        ERC20(name_, symbol_)
    {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Open faucet mint (sandbox only).
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Open burn (sandbox only). Lets ManagedTreasury simulate
    ///         oracle-priced swaps by burning the in-asset and minting the
    ///         out-asset; reverts if `from` lacks balance.
    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}
