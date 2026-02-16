// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StableCoin} from "./StableCoin.sol";

contract CrossBorderPayment is Ownable {
    enum PaymentStatus {
        PENDING_FX,
        FX_RATE_SET,
        COMPLETED
    }

    struct Payment {
        uint256 id;
        address sender;
        address receiver;
        uint256 iEURAmount;
        uint256 iAUDAmount;
        PaymentStatus status;
    }

    address public iEUR;
    address public iAUD;
    uint256 public nextPaymentId;

    mapping(uint256 => Payment) public payments;

    event PaymentInitiated(
        uint256 indexed paymentId,
        address indexed sender,
        address indexed receiver,
        uint256 amount
    );
    event FXRateSet(uint256 indexed paymentId, uint256 iAUDAmount);
    event PaymentCompleted(
        uint256 indexed paymentId,
        address indexed sender,
        address indexed receiver,
        uint256 amount
    );

    constructor(address _iEUR, address _iAUD) Ownable(msg.sender) {
        iEUR = _iEUR;
        iAUD = _iAUD;
    }

    function initPayment(address receiver, uint256 iEURAmount) external {
        require(iEURAmount > 0, "Amount must be greater than 0");
        require(receiver != address(0), "Invalid receiver address");

        uint256 paymentId = nextPaymentId++;

        payments[paymentId] = Payment({
            id: paymentId,
            sender: msg.sender,
            receiver: receiver,
            iEURAmount: iEURAmount,
            iAUDAmount: 0,
            status: PaymentStatus.PENDING_FX
        });

        emit PaymentInitiated(paymentId, msg.sender, receiver, iEURAmount);
    }

    function setFXRate(
        uint256 paymentId,
        uint256 iAUDAmount
    ) external onlyOwner {
        Payment storage payment = payments[paymentId];
        require(
            payment.status == PaymentStatus.PENDING_FX,
            "Payment not in PENDING_FX status"
        );
        require(iAUDAmount > 0, "FX amount must be greater than 0");

        payment.iAUDAmount = iAUDAmount;
        payment.status = PaymentStatus.FX_RATE_SET;

        emit FXRateSet(paymentId, iAUDAmount);
    }

    function executePayment(uint256 paymentId) external {
        Payment storage payment = payments[paymentId];
        require(
            payment.sender == msg.sender,
            "Only sender can execute payment"
        );
        require(
            payment.status == PaymentStatus.FX_RATE_SET,
            "Payment not in FX_RATE_SET status"
        );

        StableCoin(iEUR).burnFrom(payment.sender, payment.iEURAmount);
        StableCoin(iAUD).mint(payment.receiver, payment.iAUDAmount);

        payment.status = PaymentStatus.COMPLETED;

        emit PaymentCompleted(
            paymentId,
            payment.sender,
            payment.receiver,
            payment.iAUDAmount
        );
    }
}
