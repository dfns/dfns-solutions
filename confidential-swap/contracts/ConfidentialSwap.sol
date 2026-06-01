// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

/**
 * @title ConfidentialSwap
 * 
 * 1:1 swaps between a public ERC-20 and a confidential ERC-7984, and an atomic sender/receiver swap between two confidential ERC-7984 tokens.
 *
 * Three flows:
 *  1. ERC20 -> ERC7984  (synchronous; the ERC-20 amount is public, the resulting cToken transfer is encrypted)
 *  2. ERC7984 -> ERC20  (asynchronous: initiate on-chain, public-decrypt off-chain via the relayer, finalize on-chain with the KMS proof)
 *  3. ERC7984 -> ERC7984 atomic sender/receiver swap (both legs encrypted)
 *
 * Reserves: 
 * - Flow 1 requires this contract to hold a confidential balance of `confToken`,
 * - Flow 2 requires it to hold an ERC-20 balance. Owner pre-funds both before demo.
 *
 * Cross-contract FHE plumbing: whenever this contract passes a `euint64` to another FHE-aware contract (an ERC-7984), 
 * it must first call `FHE.allowTransient(value, callee)` so the callee can run FHE ops on the ciphertext for the duration of the tx.
 */
contract ConfidentialSwap is Ownable, ZamaEthereumConfig {
    using SafeERC20 for IERC20;

    struct PendingErc20Swap {
        address cToken;
        address erc20;
        address recipient;
        euint64 handle;
        bool finalized;
    }

    struct PendingCTokenSwap {
        address sender;
        address receiver;
        address tokenA;
        address tokenB;
        euint64 amountAHandle;
        euint64 amountBHandle;
        bool filled;
    }

    uint256 private _swapNonce;
    mapping(uint256 => PendingErc20Swap) public erc20Swaps;
    mapping(uint256 => PendingCTokenSwap) public cTokenSwaps;

    event Erc20ToCTokenSwap(
        address indexed sender,
        address indexed recipient,
        address indexed cToken,
        address erc20,
        uint64 amount
    );

    event CTokenToErc20Initiated(
        uint256 indexed swapId,
        address indexed sender,
        address indexed recipient,
        address cToken,
        address erc20,
        euint64 amountHandle
    );

    event CTokenToErc20Finalized(uint256 indexed swapId, uint64 amount);

    event CTokenSwapCreated(
        uint256 indexed swapId,
        address indexed sender,
        address indexed receiver,
        address tokenA,
        address tokenB,
        euint64 amountAHandle,
        euint64 amountBHandle
    );

    event CTokenSwapFilled(uint256 indexed swapId);

    constructor(address owner) Ownable(owner) {}

    // Flow 1: ERC20 -> ERC7984

    /**
     * Caller pays `amount` of `erc20` (must have approved this contract) and eceives the same amount as an encrypted balance on `cToken`.
     */
    function swapErc20ToCToken(
        address erc20,
        address cToken,
        address recipient,
        uint64 amount
    ) external {
        IERC20(erc20).safeTransferFrom(msg.sender, address(this), amount);

        euint64 encrypted = FHE.asEuint64(amount);
        FHE.allowTransient(encrypted, cToken);

        IERC7984(cToken).confidentialTransfer(recipient, encrypted);

        emit Erc20ToCTokenSwap(msg.sender, recipient, cToken, erc20, amount);
    }

    // Flow 2: ERC7984 -> ERC20

    /**
     * Step 1
     * 
     * Caller must have called `setOperator(swap, ...)` on `cToken` and encrypted `encAmount` against (cToken, swap) -- i.e. the inputProof must
     * bind the encrypted input to (target=cToken, caller=this). The cToken pulls the encrypted amount from caller into this contract's
     * confidential reserve, returns the actually-transferred handle, which we then mark publicly decryptable. 
     * The relayer's `publicDecrypt` on that handle yields the cleartext + KMS proof needed by {finalizeCTokenToErc20}.
     */
    function initiateCTokenToErc20(
        address cToken,
        address erc20,
        externalEuint64 encAmount,
        bytes calldata inputProof,
        address recipient
    ) external returns (uint256 swapId) {
        euint64 transferred = IERC7984(cToken).confidentialTransferFrom(
            msg.sender,
            address(this),
            encAmount,
            inputProof
        );
        FHE.allowThis(transferred);
        FHE.makePubliclyDecryptable(transferred);

        swapId = ++_swapNonce;
        erc20Swaps[swapId] = PendingErc20Swap({
            cToken: cToken,
            erc20: erc20,
            recipient: recipient,
            handle: transferred,
            finalized: false
        });

        emit CTokenToErc20Initiated(swapId, msg.sender, recipient, cToken, erc20, transferred);
    }

    /**
     * Step 2
     * 
     * Anyone can call this once the KMS has produced a public-decryption result. 
     * `cleartextAmount` and `decryptionProof` come from the relayer's `publicDecrypt([handle])` response and are verified by the FHE library
     * against the KMS signers; equivalent ERC-20 is then released to the recipient.
     */
    function finalizeCTokenToErc20(
        uint256 swapId,
        uint64 cleartextAmount,
        bytes calldata decryptionProof
    ) external {
        PendingErc20Swap storage swap = erc20Swaps[swapId];
        require(swap.recipient != address(0), "Unknown swap");
        require(!swap.finalized, "Already finalized");

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = euint64.unwrap(swap.handle);
        FHE.checkSignatures(handles, abi.encode(cleartextAmount), decryptionProof);

        swap.finalized = true;
        IERC20(swap.erc20).safeTransfer(swap.recipient, cleartextAmount);

        emit CTokenToErc20Finalized(swapId, cleartextAmount);
    }

    // Flow 3: ERC7984 <-> ERC7984 atomic sender/receiver swap

    /**
     * Sender side. 
     * Escrows `encAmountA` of `tokenA` (input bound to (tokenA, swap)) and pins `encAmountB` of `tokenB` (input bound to (swap, sender)) as the
     * price the receiver must pay. The receiver is granted user-decrypt access to
     * `amountB` so they can verify the price off-chain before filling.
     * 
     * Sender must have called `setOperator(swap, ...)` on `tokenA`.
     */
    function createCTokenSwap(
        address tokenA,
        externalEuint64 encAmountA,
        bytes calldata proofA,
        address tokenB,
        externalEuint64 encAmountB,
        bytes calldata proofB,
        address receiver
    ) external returns (uint256 swapId) {
        // Escrow tokenA. The transfer is done inside tokenA, so encAmountA must bind to
        // (target=tokenA, caller=this). The cToken returns transient access on `transferred`.
        euint64 transferredA = IERC7984(tokenA).confidentialTransferFrom(
            msg.sender,
            address(this),
            encAmountA,
            proofA
        );
        FHE.allowThis(transferredA);

        // Pin the sender-specified amountB. The encryption is verified here, so encAmountB
        // must bind to (target=this, caller=msg.sender).
        euint64 amountB = FHE.fromExternal(encAmountB, proofB);
        // Persist access for this contract so a later fillCTokenSwap (a separate tx)
        // can re-grant transient access to tokenB; allow the receiver/sender for
        // off-chain user-decrypt of the agreed price.
        FHE.allowThis(amountB);
        FHE.allow(amountB, receiver);
        FHE.allow(amountB, msg.sender);

        swapId = ++_swapNonce;
        cTokenSwaps[swapId] = PendingCTokenSwap({
            sender: msg.sender,
            receiver: receiver,
            tokenA: tokenA,
            tokenB: tokenB,
            amountAHandle: transferredA,
            amountBHandle: amountB,
            filled: false
        });

        emit CTokenSwapCreated(swapId, msg.sender, receiver, tokenA, tokenB, transferredA, amountB);
    }

    /**
     * Receiver side. 
     * 
     * Completes the atomic swap: pulls the sender-specified amount of tokenB` from the receiver to the sender, then releases the escrowed `tokenA` to the receiver.
     * 
     * Receiver must have called `setOperator(swap, ...)` on `tokenB`.
     */
    function fillCTokenSwap(uint256 swapId) external {
        PendingCTokenSwap storage s = cTokenSwaps[swapId];
        require(s.receiver == msg.sender, "Not receiver");
        require(!s.filled, "Already filled");
        s.filled = true;

        FHE.allowTransient(s.amountBHandle, s.tokenB);
        IERC7984(s.tokenB).confidentialTransferFrom(msg.sender, s.sender, s.amountBHandle);

        FHE.allowTransient(s.amountAHandle, s.tokenA);
        IERC7984(s.tokenA).confidentialTransfer(msg.sender, s.amountAHandle);

        emit CTokenSwapFilled(swapId);
    }

    function withdrawErc20(address erc20, address to, uint256 amount) external onlyOwner {
        IERC20(erc20).safeTransfer(to, amount);
    }
}
