// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

library BondMath {
    uint256 public constant YEAR_IN_SECONDS = 365 days;
    uint256 public constant LEAP_YEAR_IN_SECONDS = 366 days;

    function calculateAccruedInterest(
        uint256 principal,
        uint256 apr,
        uint256 timeElapsed
    ) internal pure returns (uint256) {
        return (principal * apr * timeElapsed) / (YEAR_IN_SECONDS * 10000);
    }

    function isLeapYear(uint256 year) internal pure returns (bool) {
        if (year % 4 != 0) {
            return false;
        }
        if (year % 100 != 0) {
            return true;
        }
        if (year % 400 != 0) {
            return true;
        }
        return false;
    }
}
