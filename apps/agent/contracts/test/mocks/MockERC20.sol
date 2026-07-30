// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// reward token whose transfers can be frozen — models an issuer pausing a stock token
contract FreezableERC20 is ERC20 {
    bool public frozen;

    constructor() ERC20("Freezable", "FRZ") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFrozen(bool f) external {
        frozen = f;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!frozen, "frozen");
        super._update(from, to, value);
    }
}

/// fee-on-transfer staking token: burns 1% on every transfer
contract FeeOnTransferERC20 is ERC20 {
    constructor() ERC20("FeeTok", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0xdead), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}
