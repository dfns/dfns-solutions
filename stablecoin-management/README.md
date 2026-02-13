# Dfns Stablecoin Management

Deploy and manage ERC-20 stablecoins using [Dfns](https://www.dfns.co) wallets.

This recipe demonstrates:

- **Stablecoin issuance** — deploy an ERC-20 stablecoin with mint, burn, and pause controls
- **Interactive management** — CLI for minting, burning, pausing, and unpausing
- **Dfns wallet integration** — all on-chain transactions are signed and broadcast through Dfns managed wallets

## Prerequisites

- Node.js v18+
- A [Dfns](https://www.dfns.co) account with API access
- A Dfns wallet funded with testnet ETH (Sepolia by default)

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
| `BANK_WALLET_ID` | Dfns wallet ID that will own and operate the stablecoin |
| `BLOCKCHAIN_RPC_URL` | RPC endpoint (default: Sepolia public RPC) |

### 2. Install and Compile

```bash
npm install
npx hardhat compile
```

### 3. Deploy a Stablecoin

```bash
npm run deploy
```

This deploys an ERC-20 stablecoin ("Bank AUD" / `bAUD`) owned by the `BANK_WALLET_ID` wallet. The deploy script prints the contract address — save it for the next step.

### 4. Manage the Stablecoin

```bash
npm run ops <contractAddress>
```

This opens an interactive CLI with the following operations:

| Operation | Description |
|---|---|
| **Pause** | Halt all token transfers |
| **Unpause** | Resume token transfers |
| **Mint** | Mint tokens to an address |
| **Burn** | Burn tokens from the bank wallet |

> **Note:** The stablecoin uses **6 decimals** (like USDC/USDT). To mint 100 tokens, enter `100000000` as the amount.

## Documentation

See the full tutorial at [docs.dfns.co/solutions/stablecoin-management](https://docs.dfns.co/solutions/stablecoin-management).

## Project Structure

```
contracts/          Solidity smart contracts
dfns/               Dfns integration scripts and CLIs
```
