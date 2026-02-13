// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {
    ERC20Burnable
} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {
    ERC20Pausable
} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {
    ERC20Permit
} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * Represents a stable coin
 * Whitelisting is not implemented yet - can be based on merkle tree (if lots of addresses or AccessControl for a smaller set)
 */
contract StableCoin is
    ERC20,
    ERC20Burnable,
    ERC20Pausable,
    Ownable,
    ERC20Permit,
    AccessControl
{
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    constructor(
        address initialOwner,
        string memory name,
        string memory symbol
    ) ERC20(name, symbol) Ownable(initialOwner) ERC20Permit(name) {
        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        _grantRole(MINTER_ROLE, initialOwner);
    }

    // Most DeFi protocols and centralized exchanges are already optimized for 6-decimal stablecoins (USDC/USDT).
    // To mint 100 Stablecoins, you must pass 100,000,000 to the mint function.
    function decimals() public view virtual override returns (uint8) {
        return 6;
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function mint(address to, uint256 amount) public onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20, ERC20Pausable) {
        super._update(from, to, value);
    }
}
