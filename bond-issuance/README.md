# Bond Issuance

Tokenized corporate bond lifecycle on **Ethereum**, secured by [Dfns](https://www.dfns.co/) wallets.

An issuer raises capital in Euro Stablecoins (EURC). Investors receive ERC-20 bond tokens representing their claim to periodic coupon payments and principal redemption at maturity. All on-chain transactions are signed through the Dfns KMS -- private keys never leave the Dfns infrastructure.

> **Full tutorial:** [docs.dfns.co/solutions/bond-issuance](https://docs.dfns.co/solutions/bond-issuance)

## Architecture

The system uses a **hybrid on-chain / off-chain** model:

- **On-chain settlement** -- all value transfers happen on-chain via smart contracts
- **Off-chain orchestration** -- scheduling and business logic live off-chain, with on-chain "pull" mechanisms for claiming

```
Issuer (Dfns Wallet)                Bond Contract               Investor (Dfns Wallet)
       |                                  |                              |
       |-- deploy bond ----------------->|                              |
       |                                  |                              |
       |                                  |<--- approve + subscribe ----|
       |                                  |     EURC held in escrow      |
       |                                  |                              |
       |-- close issuance -------------->|                              |
       |                                  |     clock starts             |
       |-- withdraw proceeds ----------->|                              |
       |                                  |                              |
       |                                  |<--- claim bond -------------|
       |                                  |     ERC-20 bond tokens minted|
       |                                  |                              |
       |-- deposit coupon (quarterly) -->|                              |
       |                                  |<--- claim coupon -----------|
       |                                  |     pro-rata EURC payout     |
       |                                  |                              |
       |-- return principal ------------>|  (at maturity)               |
       |                                  |<--- redeem -----------------|
       |                                  |     bonds burned, EURC back  |
```

### Bond lifecycle

1. **Primary issuance** -- Investors subscribe by depositing EURC. Issuer closes issuance, locking the interest accrual clock.
2. **Coupon payments** -- Issuer funds each coupon period. Holders claim their pro-rata share: `(userBalance / totalSupply) * couponAmount`.
3. **Default protection** -- If a coupon is not funded within a 5-day grace period, anyone can trigger default.
4. **Redemption** -- At maturity, issuer deposits principal. Holders redeem: bonds are burned, original investment returned in EURC.

### Interest math

```
Accrued = (principal * APR * timeElapsed) / (365 days * 10000)
```

APR is expressed in basis points (400 = 4%). Stablecoin and bond tokens both use 6 decimals.

## Tech stack

- **Contracts**: Solidity 0.8.28 (OpenZeppelin, Hardhat v3)
- **Signing**: Dfns KMS via `@dfns/sdk`
- **Scripts**: TypeScript (tsx, viem)
- **Web UI**: Single-page Express app with split Issuer/Investor dashboards
- **Stablecoin**: ERC-20 with mint/burn/pause (6 decimals)
- **Network**: Ethereum Sepolia

## Quick start

### 1. Prerequisites

- Node.js v22+
- A [Dfns](https://www.dfns.co/) account with API credentials
- Two Dfns wallets on Ethereum Sepolia (one for the issuer, one for the investor)

### 2. Install

```bash
cd bond-issuance
npm install
```

### 3. Compile contracts

```bash
npm run compile
```

### 4. Run tests

```bash
npm test
```

Tests cover the full lifecycle: subscription, over/under-subscription, coupon claims, redemption, grace periods, default triggering, and interest math (including leap-year edge cases).

### 5. Configure environment

```bash
cp .env.example .env
```

Fill in your `.env`:

| Variable | Description |
|---|---|
| `DFNS_API_URL` | Dfns API base URL (default: `https://api.dfns.io`) |
| `DFNS_ORG_ID` | Your Dfns organization ID |
| `DFNS_AUTH_TOKEN` | Service account auth token |
| `DFNS_CRED_ID` | Credential ID for the signing key |
| `DFNS_PRIVATE_KEY` | Private key (PEM) for signing API requests |
| `ISSUER_WALLET_ID` | Dfns wallet ID for the bond issuer |
| `INVESTOR_WALLET_ID` | Dfns wallet ID for the investor |
| `SEPOLIA_RPC_URL` | (Optional) Sepolia RPC endpoint |

### 6. Deploy and operate

**Deploy the stablecoin:**

```bash
npm run deploy:stablecoin
```

**Mint stablecoin to the investor:**

```bash
npm run mint:stablecoin
```

**Deploy the bond:**

```bash
npm run deploy:bond
```

**Issuer operations** (close issuance, deposit coupons, return principal):

```bash
npm run ops:issuer
```

**Holder operations** (subscribe, claim bonds, claim coupons, redeem):

```bash
npm run ops:holder
```

**Stablecoin management** (mint, burn, pause):

```bash
npm run ops:stablecoin
```

### 7. Web UI

Run the web UI to walk through the full bond lifecycle from your browser:

```bash
npm run ui
```

Open [http://localhost:3000](http://localhost:3000). The UI shows two dashboards side by side — Issuer (blue) and Investor (green) — with numbered steps to follow in order. Each action calls the Dfns API to sign and broadcast transactions on Sepolia.

### 8. End-to-end script

Run the full lifecycle non-interactively (deploy, subscribe, close, coupon, claim):

```bash
npm run e2e
```

## CLI walkthrough

A typical end-to-end flow:

```bash
# 1. Deploy stablecoin
npm run deploy:stablecoin
# -> Note the contract address

# 2. Mint EURC to investor wallet
npm run mint:stablecoin
# -> Enter stablecoin address, investor address, amount

# 3. Deploy bond (references stablecoin address)
npm run deploy:bond
# -> Configure: name, notional, APR, frequency, maturity, cap
# -> Note the bond contract address

# 4. Investor subscribes
npm run ops:holder
# -> Option 2: Approve + Subscribe

# 5. Issuer closes issuance and withdraws proceeds
npm run ops:issuer
# -> Option 2: Close Issuance
# -> Option 3: Withdraw Proceeds

# 6. Investor claims bond tokens
npm run ops:holder
# -> Option 3: Claim Bond

# 7. Each coupon period: issuer deposits, investor claims
npm run ops:issuer    # -> Option 5: Deposit Coupon
npm run ops:holder    # -> Option 4: Claim Coupon (auto-detects due coupons)

# 8. At maturity: issuer returns principal, investor redeems
npm run ops:issuer    # -> Option 4: Return Principal
npm run ops:holder    # -> Option 5: Redeem
```

## Contracts

| Contract | Description |
|---|---|
| `Bond.sol` | ERC-20 bond token with full lifecycle: subscription, coupon, redemption, default |
| `BondMath.sol` | Library for accrued interest calculation |
| `StableCoin.sol` | ERC-20 stablecoin with mint/burn/pause and access control |

## License

MIT
