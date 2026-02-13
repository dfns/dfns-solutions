# Dfns Cross-Border Payments

Process cross-border payments with FX conversion between stablecoins using [Dfns](https://www.dfns.co) wallets.

This recipe demonstrates:

- **Cross-border payments** — multi-step payment flow with FX conversion between two stablecoins
- **Multi-actor workflow** — Bank, Sender, FX Provider, and Receiver each have dedicated CLIs
- **Dfns wallet integration** — all on-chain transactions are signed and broadcast through Dfns managed wallets

## Prerequisites

- Node.js v18+
- A [Dfns](https://www.dfns.co) account with API access
- Three Dfns wallets (Bank, Sender, Receiver), each funded with testnet ETH (Sepolia by default)

## How It Works

A cross-border payment flows through three stages:

1. **Sender initiates** — the sender creates a payment specifying the receiver and iEUR amount
2. **FX Provider sets rate** — the bank/FX provider sets the conversion rate (iEUR → iAUD)
3. **Sender executes** — the sender confirms the rate and executes; iEUR is burned, iAUD is minted to the receiver

The system uses two stablecoins: **iEUR** (source currency) and **iAUD** (destination currency), managed by a `CrossBorderPayment` contract that handles the FX lifecycle.

## Quick Start

### 1. Configure Environment

```bash
cp .env.example .env
```

Fill in your `.env`:

| Variable | Description |
|---|---|
| `DFNS_API_URL` | Dfns API base URL (default: `https://api.dfns.io`) |
| `DFNS_ORG_ID` | Your Dfns organization ID |
| `DFNS_AUTH_TOKEN` | Service account auth token from Dfns dashboard |
| `DFNS_CRED_ID` | Credential ID for the signing key |
| `DFNS_PRIVATE_KEY` | Private key (PEM format) for signing requests |
| `BANK_WALLET_ID` | Dfns wallet ID for the bank (deploys contracts, sets FX rates) |
| `SENDER_WALLET_ID` | Dfns wallet ID for the sender (initiates and executes payments) |
| `RECEIVER_WALLET_ID` | Dfns wallet ID for the receiver |
| `BLOCKCHAIN_RPC_URL` | RPC endpoint (default: Sepolia public RPC) |

### 2. Install and Compile

```bash
npm install
npx hardhat compile
```

### 3. Run Tests (local Hardhat network)

```bash
npx hardhat test
```

### 4. Deploy the System

```bash
npm run deploy
```

The deploy script:
- Deploys **iEUR** and **iAUD** stablecoins (owned by the bank wallet)
- Deploys the **CrossBorderPayment** contract
- Transfers iAUD ownership to the CrossBorderPayment contract
- Mints 1000 iEUR to the sender wallet

Save the three contract addresses printed at the end.

### 5. Grant Minter Role

After deploying, grant `MINTER_ROLE` on iAUD to the CrossBorderPayment contract so it can mint iAUD to receivers:

```bash
npm run receiver-cli grantRole MINTER_ROLE <iAUD_ADDRESS> <CBP_ADDRESS>
```

### 6. Run a Payment

```bash
# Sender initiates a payment of 100 iEUR to the receiver
npm run sender-cli init <CBP_ADDRESS> <iEUR_ADDRESS> <RECEIVER_ADDRESS> 100

# FX provider sets the conversion rate (e.g. 100 iEUR = 165 iAUD)
npm run fx-cli set-rate <CBP_ADDRESS> 0 165

# Sender executes the payment at the agreed rate
npm run sender-cli execute <CBP_ADDRESS> 0
```

> **Note:** All stablecoins use **6 decimals**. The CLIs accept human-readable amounts (e.g. `100` = 100 tokens).

## CLI Reference

### Sender CLI (`npm run sender-cli`)

| Action | Usage |
|---|---|
| `init` | `init <cbpAddress> <iEurAddress> <receiverAddress> <amount>` — Approve iEUR and initiate payment |
| `execute` | `execute <cbpAddress> <paymentId>` — Execute a payment after FX rate is set |
| `approve` | `approve <tokenAddress> <spenderAddress> <amount>` — Approve token spending |

### FX Provider CLI (`npm run fx-cli`)

| Action | Usage |
|---|---|
| `set-rate` | `set-rate <cbpAddress> <paymentId> <amount>` — Set the iAUD conversion amount for a payment |

### Receiver CLI (`npm run receiver-cli`)

| Action | Usage |
|---|---|
| `grantRole` | `grantRole <roleName> <contractAddress> <accountAddress>` — Grant a role on a StableCoin contract |

## Documentation

See the full tutorial at [docs.dfns.co/solutions/cross-border-payments](https://docs.dfns.co/solutions/cross-border-payments).

## Project Structure

```
contracts/          Solidity smart contracts (StableCoin + CrossBorderPayment)
dfns/               Dfns integration scripts and CLIs
test/               Hardhat tests
```
