# DFNS × Zama — Confidential Atomic Swap Demo

Three atomic-swap flows demonstrated on Sepolia, signed end-to-end by DFNS-managed
wallets and using Zama FHEVM (ERC-7984 / OpenZeppelin confidential-contracts) for
the confidential leg:

1. **ERC-20 → ERC-7984** — synchronous. The sender pays a public ERC-20 amount and
   receives the same amount as an encrypted balance on the confToken.
2. **ERC-7984 → ERC-20** — asynchronous. The sender transfers an encrypted confToken
   amount to the swap contract; the contract marks the transferred-amount handle
   publicly decryptable; the relayer's KMS produces a cleartext + decryption proof
   that finalises the swap and releases the matching ERC-20.
3. **ERC-7984 ↔ ERC-7984** — atomic sender / receiver. The sender escrows an encrypted
   amount of token A and pins an encrypted amount of token B as their price. The
   receiver fills the order, paying token B and receiving token A in the same tx.

Rate is fixed 1:1 across all three flows.

## Layout

```
confidential-swap/
├── contracts/
│   ├── PlainToken.sol            # OZ ERC-20 + Ownable mint
│   ├── ConfidentialToken.sol     # OZ ERC-7984 + Ownable + ZamaEthereumConfig
│   └── ConfidentialSwap.sol      # The three-flow swap contract
└── dfns/
    ├── DfnsCommon.ts             # DFNS client, viem, FHEVM, broadcast, deployment
    ├── DeployPlainToken.ts       # Deploy plainEUR (ERC-20, 6 decimals)
    ├── DeployConfidentialTokens.ts  # Deploy confSGD and confEUR (ERC-7984)
    ├── DeploySwap.ts             # Deploy ConfidentialSwap
    ├── MintPlainToken.ts         # Bank mints plainEUR to a role / address / swap
    ├── MintConfidentialToken.ts  # Bank mints confSGD or confEUR (encrypted)
    ├── Approve.ts                # ERC-20 approve  /  ERC-7984 setOperator
    ├── SwapErc20ToconfToken.ts      # Flow 1
    ├── SwapconfTokenToErc20.ts      # Flow 2 (initiate + publicDecrypt + finalize)
    ├── SwapconfTokenToconfToken.ts     # Flow 3 (create + fill)
    └── RevealBalance.ts          # Public balanceOf or DFNS-signed userDecrypt
```

## Setup

```bash
cd confidential-swap
npm install
cp .env.example .env
# Fill in DFNS_* and the three wallet IDs: BANK, SENDER, RECEIVER
npm run compile
```

Three DFNS EVM wallets on Sepolia are needed, each funded with a little test ETH:

| Wallet   | Role                                                                  |
|----------|-----------------------------------------------------------------------|
| BANK     | Deploys contracts, owns them, mints initial token supplies & reserves |
| SENDER   | Initiates every swap — flows 1 & 2 (ERC-20 ↔ confSGD) and the flow-3 give side (gives confSGD, wants confEUR) |
| RECEIVER | Flow-3 fill side (gives confEUR, gets confSGD)                         |

## End-to-end demo

```bash
# --- Deploy ---
npm run deploy:plain          # plainEUR (ERC-20)
npm run deploy:confTokens        # confSGD and confEUR (ERC-7984)
npm run deploy:swap           # ConfidentialSwap

# --- Mint initial balances ---
# Sender: 1000 plainEUR and 1000 confSGD
npm run mint:plain  -- sender 1000
npm run mint:confToken -- confSGD sender 1000

# Receiver: 1000 confEUR (to pay the flow-3 price)
npm run mint:confToken -- confEUR receiver 1000

# Pre-fund the swap with reserves
npm run mint:plain  -- swap 5000      # ERC-20 reserve for flow 2
npm run mint:confToken -- confSGD swap 5000  # confToken reserve for flow 1

# --- Approvals (one tx per role+token) ---
npm run approve -- sender   plainToken   # ERC-20 approve(swap, MAX)
npm run approve -- sender   confSGD      # ERC-7984 setOperator(swap, +1y)
npm run approve -- receiver confEUR

# --- Run the three swaps ---
npm run swap:erc20-to-confToken  -- 100  # SENDER trades 100 plainEUR -> 100 confSGD
npm run swap:confToken-to-erc20  -- 50   # SENDER trades 50  confSGD -> 50  plainEUR
npm run swap:confToken-to-confToken -- 100 80  # SENDER trades 100 confSGD for 80 confEUR with RECEIVER

# --- Inspect balances ---
npm run reveal -- sender   plainToken  # plainEUR balance (public)
npm run reveal -- sender   confSGD     # confSGD balance (DFNS-signed user-decrypt)
npm run reveal -- sender   confEUR     # confEUR balance (received from receiver)
npm run reveal -- receiver confSGD     # confSGD balance (received from sender)
```

## How each flow works

### Flow 1 — ERC-20 → ERC-7984 (synchronous)

```
SENDER ── ERC20.approve(swap, MAX) ───────────────────────────►
SENDER ── swap.swapErc20ToconfToken(plainEUR, confSGD, SENDER, amount) ──►
        │
        ├── plainEUR.transferFrom(SENDER, swap, amount)
        ├── enc = FHE.asEuint64(amount)         (trivially encrypted)
        ├── FHE.allowTransient(enc, confSGD)       (let confSGD operate on the ct)
        └── confSGD.confidentialTransfer(SENDER, enc)
              └── _transfer(swap, SENDER, enc)    (consumes the swap's reserve)
```

The ERC-20 amount is public (visible in calldata); the confToken transfer itself is
a regular ERC-7984 confidential transfer (encrypted balance updates).

### Flow 2 — ERC-7984 → ERC-20 (asynchronous, two on-chain steps)

```
SENDER (off-chain): encrypt amount bound to (confSGD, swap)

SENDER ── confSGD.setOperator(swap, until) ───────────────────────►
SENDER ── swap.initiateconfTokenToErc20(confSGD, plainEUR, encAmount, proof, SENDER)
        │
        ├── confSGD.confidentialTransferFrom(SENDER, swap, encAmount, proof)
        │     └── returns euint64 handle of the actually-transferred amount
        ├── FHE.allowThis(transferred)
        ├── FHE.makePubliclyDecryptable(transferred)
        └── emits confTokenToErc20Initiated(swapId, handle)

SENDER (off-chain): relayer.publicDecrypt([handle])
        └── returns { clearValues[handle], decryptionProof }   (KMS-signed)

SENDER ── swap.finalizeconfTokenToErc20(swapId, clearValue, decryptionProof) ─►
        │
        ├── FHE.checkSignatures(handles, abi.encode(clear), proof)  (validates KMS sigs)
        └── plainEUR.transfer(SENDER, clearValue)
```

This is the canonical OZ "handled-unwrap" pattern: the contract never sees the
amount in cleartext, but it can verify a KMS-signed cleartext and release the
matching ERC-20 atomically with the verification.

### Flow 3 — ERC-7984 ↔ ERC-7984 atomic sender / receiver

```
SENDER (off-chain): encrypt amountA bound to (confSGD, swap)
                    encrypt amountB bound to (swap, SENDER)

SENDER ── confSGD.setOperator(swap, until) ───────────────────────►
SENDER ── swap.createconfTokenSwap(
            confSGD, encA, proofA,
            confEUR, encB, proofB,
            RECEIVER) ──────────────────────────────────────────►
        │
        ├── confSGD.confidentialTransferFrom(SENDER, swap, encA, proofA)
        │     └── escrows transferredA on the swap contract
        ├── FHE.fromExternal(encB, proofB) → amountB
        ├── FHE.allow(amountB, RECEIVER)   (so receiver can audit price off-chain)
        ├── FHE.allow(amountB, SENDER)
        └── emits confTokenSwapCreated(swapId, …)

RECEIVER ── confEUR.setOperator(swap, until) ─────────────────────►
RECEIVER ── swap.fillconfTokenSwap(swapId) ───────────────────────►
        │
        ├── FHE.allowTransient(amountB, confEUR)
        ├── confEUR.confidentialTransferFrom(RECEIVER, SENDER, amountB)
        ├── FHE.allowTransient(amountA, confSGD)
        └── confSGD.confidentialTransfer(RECEIVER, amountA)
              └── _transfer(swap, RECEIVER, amountA)
```

Both legs are encrypted. The price (`amountB`) is FHE-allowed to the receiver so they
can `userDecrypt` it before agreeing to fill (or simply trust the sender's off-chain
quote). The fill is atomic: either both transfers succeed or the whole tx reverts.

## Notes & gotchas

- **Cross-contract FHE access.** Whenever the swap passes a `euint64` to an
  ERC-7984 contract, it must first call `FHE.allowTransient(value, callee)` so the
  ERC-7984 can run FHE ops on the ciphertext for the duration of the tx. Forgetting
  this is the #1 source of `FHE access not granted` reverts.
- **Encrypted-input binding.** Inputs from the relayer SDK are bound to
  `(contractAddress, callerAddress)` at encryption time, where `contractAddress`
  is the contract that will call `FHE.fromExternal` (it may be the swap or the
  confToken depending on which entry point is used) and `callerAddress` is the
  `msg.sender` of that contract.
  - Flow 1: no encrypted input (public amount).
  - Flow 2: bound to `(confSGD, swap)` (the confToken does `FHE.fromExternal`).
  - Flow 3: amountA bound to `(confSGD, swap)`, amountB bound to `(swap, sender)`.
- **Reserves.** Flow 1 spends the swap's confToken reserve; flow 2 spends its ERC-20
  reserve. Pre-fund both before running the matching script.
- **6 decimals everywhere.** Both ERC-20 and ERC-7984 are deployed with 6 decimals
  so the 1:1 rate is trivial. Increasing decimals on one side would require
  changing the swap to scale.
- **No partial fills.** The atomic swap is all-or-nothing. There's also no cancel
  function on the demo contract — if a receiver never fills, the sender's escrow stays
  on the swap (easy to add, omitted for brevity).
- **`Solidity 0.8.27`, EVM target `cancun`** — required by `@fhevm/solidity` 0.11.

## References

- OpenZeppelin Confidential Contracts — <https://docs.openzeppelin.com/confidential-contracts/token>
- Zama Relayer SDK guides — <https://docs.zama.org/protocol/solidity-guides/v0.10/docs/sdk-guides>
- DFNS SDK — <https://www.npmjs.com/package/@dfns/sdk>
- Companion demo (single confidential token, no swap) — `../zama`

## Tests

A full end-to-end run on **Sepolia**, signed throughout by DFNS-managed wallets.
Every contract deployment, swap and balance reveal below is reproduced from a live
run against the deployed contracts.

### Deployed contracts

| Contract | Token | Address |
|----------|-------|---------|
| `PlainToken.sol`       | plainEUR | [`0x47bd…0770`](https://sepolia.etherscan.io/address/0x47bd5d26b1661f0611dddf3741ccd4ea1a390770) |
| `ConfidentialToken.sol`| confSGD  | [`0xbccb…785d`](https://sepolia.etherscan.io/address/0xbccb2c5f1341e6c7a06561e6d044ffdfbe01785d) |
| `ConfidentialToken.sol`| confEUR  | [`0x7dff…2e39d`](https://sepolia.etherscan.io/address/0x7dffb6980c0114e392935a8d812b7c4f4f22e39d) |
| `ConfidentialSwap.sol` | —        | [`0xcecc…42e9`](https://sepolia.etherscan.io/address/0xcecc1c3ccd45bd5ae48ad0bf923cd340937142e9) |

### 1. Initial balances (empty)

Reveal balances per role and token. Plain balances are read directly; confidential
balances are decrypted via a DFNS-signed `userDecrypt`.

```bash
npm run reveal -- sender   plainToken
npm run reveal -- receiver plainToken
npm run reveal -- sender   confSGD
npm run reveal -- sender   confEUR
npm run reveal -- receiver confSGD
npm run reveal -- receiver confEUR
```

Plain balances return `0`; confidential balances return a zero handle
(`0x0000…0000`) — nothing to decrypt. The aggregate view via `npm run reveal:all`:

```
┌─────────┬────────────┬────────┬──────────┐
│ (index) │ Token      │ Sender │ Receiver │
├─────────┼────────────┼────────┼──────────┤
│ 0       │ 'plainEUR' │ '0'    │ '0'      │
│ 1       │ 'confSGD'  │ '0'    │ '0'      │
│ 2       │ 'confEUR'  │ '0'    │ '0'      │
└─────────┴────────────┴────────┴──────────┘
```

### 2. Minting & approvals

```bash
npm run mint:plain     -- sender 2000
npm run mint:confToken -- confSGD sender 2000
npm run mint:confToken -- confEUR receiver 1000

# Pre-fund the swap with reserves
npm run mint:plain     -- swap 5000
npm run mint:confToken -- confSGD swap 5000

# Approvals
npm run approve -- sender   plainToken
npm run approve -- sender   confSGD
npm run approve -- receiver confEUR
```

State of all wallets before the swaps:

```
┌─────────┬────────────┬────────┬──────────┐
│ (index) │ Token      │ Sender │ Receiver │
├─────────┼────────────┼────────┼──────────┤
│ 0       │ 'plainEUR' │ '2000' │ '0'      │
│ 1       │ 'confSGD'  │ '1000' │ '0'      │
│ 2       │ 'confEUR'  │ '0'    │ '1000'   │
└─────────┴────────────┴────────┴──────────┘
```

### 3. Swaps

#### Flow 1 — SENDER trades 100 plainEUR for 100 confSGD

[View transaction ↗](https://sepolia.etherscan.io/tx/0x54988257c5e68b8e8f2081fc64f8342765dcc7a6b0bb64275cd31253bdf92f30)

```bash
npm run swap:erc20-to-confToken -- 100
```

```
┌─────────┬────────────┬────────┬──────────┐
│ (index) │ Token      │ Sender │ Receiver │
├─────────┼────────────┼────────┼──────────┤
│ 0       │ 'plainEUR' │ '1900' │ '0'      │
│ 1       │ 'confSGD'  │ '1100' │ '0'      │
│ 2       │ 'confEUR'  │ '0'    │ '1000'   │
└─────────┴────────────┴────────┴──────────┘
```

#### Flow 2 — SENDER trades 50 confSGD for 50 plainEUR

[View transaction ↗](https://sepolia.etherscan.io/tx/0x187e5363cae8a9890751637bbfe28e87962eb4b2582ec8fc5aa3f0b788acfa3c)

```bash
npm run swap:confToken-to-erc20 -- 50
```

```
┌─────────┬────────────┬────────┬──────────┐
│ (index) │ Token      │ Sender │ Receiver │
├─────────┼────────────┼────────┼──────────┤
│ 0       │ 'plainEUR' │ '1950' │ '0'      │
│ 1       │ 'confSGD'  │ '1050' │ '0'      │
│ 2       │ 'confEUR'  │ '0'    │ '1000'   │
└─────────┴────────────┴────────┴──────────┘
```

#### Flow 3 — SENDER trades 100 confSGD for 80 confEUR with RECEIVER

[View transaction ↗](https://sepolia.etherscan.io/tx/0x2aceebdb6ca726f436b0e0c0ca998c8c9f63989c33fcc4e08afdac811108712c)

```bash
npm run swap:confToken-to-confToken -- 100 80
```

```
┌─────────┬────────────┬────────┬──────────┐
│ (index) │ Token      │ Sender │ Receiver │
├─────────┼────────────┼────────┼──────────┤
│ 0       │ 'plainEUR' │ '1950' │ '0'      │
│ 1       │ 'confSGD'  │ '550'  │ '100'    │
│ 2       │ 'confEUR'  │ '80'   │ '920'    │
└─────────┴────────────┴────────┴──────────┘
```

All three flows executed successfully on-chain, with every transaction signed by
DFNS-managed wallets and the confidential legs settled through Zama FHEVM.
