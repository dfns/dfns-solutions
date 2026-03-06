// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BondMath} from "./BondMath.sol";

contract Bond is ERC20, Ownable {
    // State Variables
    IERC20 public currency; // The Euro Stablecoin
    uint256 public notional; // Face value (e.g. 100 * 10^6)
    uint256 public apr; // Basis points (e.g. 400 = 4%)
    uint256 public frequency; // Seconds
    uint256 public maturityDate; // Timestamp
    uint256 public metadata; // Optional metadata hash
    uint256 public issuanceDate; // When issuance closes
    uint256 public cap; // Maximum to raise

    uint256 public constant GRACE_PERIOD = 5 days;
    bool public isDefaulted;
    bool public issuanceClosed;

    mapping(uint256 => bool) public couponFunded; // Tracks if coupon (1, 2, 3...) is funded
    mapping(uint256 => uint256) public couponAmounts; // Amount deposited for each coupon
    mapping(address => uint256) public subscriptionReceipts;
    mapping(uint256 => mapping(address => bool)) public couponClaimed; // couponIndex => user => claimed

    // Coupon Calculations
    uint256 public couponAmountPerPeriod; // Calculated amount per coupon period
    uint256 public nextCouponIndex = 1; // Next coupon to be funded

    // View Variables
    uint256 public totalBondsIssued;
    uint256 public totalBondsRedeemed;
    uint256 public totalSubscribed;

    // Events
    event Subscribed(address indexed user, uint256 amount);
    event IssuanceClosed(uint256 totalRaised, uint256 timestamp);
    event BondClaimed(address indexed user, uint256 amount);
    event CouponFunded(uint256 indexed couponIndex, uint256 amount);
    event CouponClaimed(
        address indexed user,
        uint256 indexed couponIndex,
        uint256 amount
    );
    event Redempted(address indexed user, uint256 amount);
    event DefaultTriggered(uint256 timestamp);

    constructor(
        string memory name,
        string memory symbol,
        address _currency,
        uint256 _notional,
        uint256 _apr,
        uint256 _frequency,
        uint256 _maturityDate,
        uint256 _cap
    ) ERC20(name, symbol) Ownable(msg.sender) {
        currency = IERC20(_currency);
        notional = _notional;
        apr = _apr;
        frequency = _frequency;
        maturityDate = _maturityDate;
        cap = _cap;
    }

    function decimals() public view virtual override returns (uint8) {
        return 6;
    }

    function subscribe(uint256 amount) external {
        require(!issuanceClosed, "Issuance closed");
        require(amount > 0, "Amount must be > 0");

        // Check Cap
        require(totalSubscribed + amount <= cap, "Cap exceeded");

        // Record subscription
        totalSubscribed += amount;
        subscriptionReceipts[msg.sender] += amount;

        // Transfer EURC to contract (Escrow)
        // User must have approved the contract first!
        currency.transferFrom(msg.sender, address(this), amount);

        emit Subscribed(msg.sender, amount);
    }

    function closePrimaryIssuance() external onlyOwner {
        require(!issuanceClosed, "Already closed");
        issuanceClosed = true;
        issuanceDate = block.timestamp;

        // Calculate Total Principal
        uint256 totalPrincipal = (totalSubscribed * notional) /
            (10 ** decimals());

        // Calculate Coupon Amount Per Period (Principal * APR * Frequency / (Year * 10000))
        couponAmountPerPeriod = BondMath.calculateAccruedInterest(
            totalPrincipal,
            apr,
            frequency
        );

        emit IssuanceClosed(totalSubscribed, block.timestamp);
    }

    function withdrawProceeds() external onlyOwner {
        require(issuanceClosed, "Issuance not closed");
        uint256 balance = currency.balanceOf(address(this));
        require(balance > 0, "No proceeds");
        currency.transfer(msg.sender, balance);
    }

    function returnPrincipal(uint256 amount) external onlyOwner {
        require(
            currency.transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );
    }

    function claimBond() external {
        require(issuanceClosed, "Issuance not closed");
        uint256 amount = subscriptionReceipts[msg.sender];
        require(amount > 0, "No subscription");

        subscriptionReceipts[msg.sender] = 0;

        uint256 bondAmount = (amount * (10 ** decimals())) / notional;

        require(bondAmount > 0, "Subscribe amount too low");

        _mint(msg.sender, bondAmount);

        totalBondsIssued += bondAmount;

        emit BondClaimed(msg.sender, bondAmount);
    }

    // --- View Functions ---

    function accruedInterest(address user) external view returns (uint256) {
        uint256 balance = balanceOf(user);
        if (balance == 0 || !issuanceClosed) return 0;

        uint256 timeElapsed = block.timestamp - issuanceDate;
        return
            BondMath.calculateAccruedInterest(
                (balance * notional) / (10 ** decimals()),
                apr,
                timeElapsed
            );
    }

    // --- Coupon Logic ---

    function getCouponAmount() external view returns (uint256) {
        return couponAmountPerPeriod;
    }

    function getNextUnfundedCoupon() external view returns (uint256) {
        return nextCouponIndex;
    }

    function depositCoupon() external onlyOwner {
        require(issuanceClosed, "Issuance not closed");
        require(!isDefaulted, "Bond defaulted");

        uint256 duration = maturityDate - issuanceDate;
        uint256 totalCoupons = duration / frequency;

        require(nextCouponIndex <= totalCoupons, "All coupons funded");

        uint256 couponIndex = nextCouponIndex;
        uint256 amount = couponAmountPerPeriod;

        currency.transferFrom(msg.sender, address(this), amount);

        couponFunded[couponIndex] = true;
        couponAmounts[couponIndex] = amount;

        nextCouponIndex++;

        emit CouponFunded(couponIndex, amount);
    }

    function getCouponDate(uint256 couponIndex) public view returns (uint256) {
        return issuanceDate + (couponIndex * frequency);
    }

    function timeToNextCoupon() public view returns (uint256) {
        if (!issuanceClosed) {
            return 0;
        }

        uint256 timeElapsed = block.timestamp - issuanceDate;
        uint256 nextCouponIndex = (timeElapsed / frequency) + 1;
        uint256 nextCouponDate = getCouponDate(nextCouponIndex);

        if (block.timestamp >= nextCouponDate) {
            return 0;
        }

        return nextCouponDate - block.timestamp;
    }

    function claimCoupon(uint256 couponIndex) external {
        require(!isDefaulted, "Bond defaulted");
        require(couponFunded[couponIndex], "Coupon not funded");

        uint256 couponDate = getCouponDate(couponIndex);
        require(block.timestamp > couponDate, "Coupon not due");

        require(!couponClaimed[couponIndex][msg.sender], "Already claimed");

        uint256 balance = balanceOf(msg.sender);
        require(balance > 0, "No bonds held");

        uint256 total = totalSupply();
        uint256 totalCouponAmount = couponAmounts[couponIndex];

        // Calculate Share
        uint256 share = (balance * totalCouponAmount) / total;

        couponClaimed[couponIndex][msg.sender] = true;

        currency.transfer(msg.sender, share);

        emit CouponClaimed(msg.sender, couponIndex, share);
    }

    // --- Redemption & Default ---

    function redeem() external {
        require(!isDefaulted, "Bond defaulted");
        require(block.timestamp >= maturityDate, "Not mature");

        uint256 balance = balanceOf(msg.sender);
        require(balance > 0, "No bonds");

        _burn(msg.sender, balance);

        totalBondsRedeemed += balance;

        uint256 payout = (balance * notional) / (10 ** decimals());

        currency.transfer(msg.sender, payout);
        emit Redempted(msg.sender, payout);
    }

    function checkDefault(uint256 couponIndex) external {
        require(!isDefaulted, "Already defaulted");

        uint256 couponDate = getCouponDate(couponIndex);

        if (
            block.timestamp > couponDate + GRACE_PERIOD &&
            !couponFunded[couponIndex]
        ) {
            isDefaulted = true;
            emit DefaultTriggered(block.timestamp);
        }
    }
}
