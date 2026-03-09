# Dfns Cross-Border Payments (Solana)

Process cross-border payments with FX conversion between stablecoins on **Solana** using [Dfns](https://www.dfns.co) wallets.

International payments require burning a source currency, applying an exchange rate, and minting the destination currency to the receiver. This solution blueprint implements that flow as an atomic on-chain swap using an **Anchor** program, with Dfns handling key management and transaction signing.

> **Full tutorial:** [docs.dfns.co/solutions/cross-border-payments-solana](https://docs.dfns.co/solutions/cross-border-payments-solana)

## Scenario

A fintech company operates a remittance corridor between Europe and Southeast Asia. When a customer in Paris sends EUR to a recipient in Singapore:

1. The **bank** initiates a payment on-chain, recording the sender, receiver, and EUR amount.
2. An **FX provider** quotes and locks the SGD conversion rate on the payment record.
3. The bank **executes** the payment -- the Solana program atomically burns tEUR from the sender and mints tSGD to the receiver in a single transaction. If either leg fails, nothing happens.

Dfns wallets secure every signing operation: the bank's private keys live in the Dfns KMS, never touching application servers. The on-chain program enforces that minted tokens can only go to the receiver specified at initialization, preventing any redirection after the fact.

## Architecture

The system uses a three-step payment flow managed by a Solana program:

1. **Initialize Payment** -- Creates a Payment PDA on-chain with a unique ID, sender, receiver, and input amount.
2. **Set FX Rate** -- An authorized entity (FX provider) locks in the output amount based on the exchange rate.
3. **Execute Payment** -- Atomically burns the source stablecoin from the sender and mints the target stablecoin to the receiver.

All transactions are signed securely through the Dfns KMS -- private keys never leave the Dfns infrastructure.

```
Sender (Dfns Wallet)              Solana Program              Receiver
        |                              |                         |
        |-- init_payment ------------->|                         |
        |                              |  PDA created            |
        |                              |  status: PendingFX      |
        |                              |                         |
FX Provider (Dfns Wallet)             |                         |
        |-- set_fx_rate -------------->|                         |
        |                              |  status: FXRateSet      |
        |                              |                         |
Sender  |-- execute_payment ---------->|                         |
        |                              |-- burn source tokens    |
        |                              |-- mint target tokens -->|
        |                              |  status: Completed      |
```

## Tech stack

- **On-chain**: Solana (Rust / Anchor 0.32)
- **Signing**: Dfns KMS via `@dfns/sdk`
- **CLI scripts**: TypeScript (tsx)
- **Stablecoins**: SPL Token with Metaplex metadata

## Quick start

### 1. Prerequisites

- Node.js v18+
- Rust / Cargo (for building the Anchor program)
- A [Dfns](https://dfns.io) account with API credentials

The setup script installs the Solana CLI and Anchor toolchain if they aren't already present:

```bash
./setup.sh
```

Or install them manually: [Solana CLI](https://docs.solanalabs.com/cli/install), [Anchor](https://www.anchor-lang.com/docs/installation) (v0.32+).

### 2. Create Dfns wallets

Create two **Solana Devnet** wallets in the [Dfns dashboard](https://app.dfns.io):

1. **Bank wallet** -- acts as the sender, mint authority, and program deployer
2. **Receiver wallet** -- the payment recipient

Fund the bank wallet with devnet SOL (for transaction fees):

```bash
solana airdrop 2 <BANK_WALLET_ADDRESS> --url devnet
```

### 3. Configure environment

```bash
cd dfns
cp .env.example .env
```

Fill in your `dfns/.env`:

| Variable | Description |
|---|---|
| `DFNS_API_URL` | Dfns API base URL (default: `https://api.dfns.io`) |
| `DFNS_ORG_ID` | Your Dfns organization ID |
| `DFNS_AUTH_TOKEN` | Service account auth token from Dfns dashboard |
| `DFNS_CRED_ID` | Credential ID for the signing key |
| `DFNS_PRIVATE_KEY` | Private key (PEM format) for signing requests |
| `BANK_WALLET_ID` | Dfns wallet ID (Solana Devnet) acting as sender, deployer, and mint authority |
| `SOURCE_MINT` | SPL token mint address for the source stablecoin (set after deploy) |
| `TARGET_MINT` | SPL token mint address for the target stablecoin (set after deploy) |
| `PROGRAM_ID` | On-chain program ID (defaults to the pre-deployed devnet address) |

### 4. Install and build

```bash
npm install
anchor build
anchor keys sync
```

### 5. Run tests (local validator)

```bash
anchor test
```

### 6. Deploy stablecoins

Deploy two SPL token mints that act as the source and target currencies:

```bash
npm run deploy:stablecoin -- "Test EUR" tEUR
npm run deploy:stablecoin -- "Test SGD" tSGD
```

The script prints the mint address and the correct env var name (`SOURCE_MINT` or `TARGET_MINT`). Copy both into your `dfns/.env`.

### 7. Deploy the program

```bash
npm run deploy:program
```

This uploads the compiled program binary to Solana Devnet via Dfns, keeping the upgrade authority in the KMS.

### 8. Fund the sender

Mint source tokens to the bank wallet:

```bash
npm run mint-tokens -- <SOURCE_MINT> <BANK_WALLET_ADDRESS> 1000000000
```

This mints 1,000 tokens (6 decimals).

### 9. Run a payment

```bash
# Step 1: Initialize a payment (id=1, receiver address, amount in base units)
npm run init-payment -- 1 <RECEIVER_ADDRESS> 500000

# Step 2: Set the FX rate (id=1, sender address, output amount)
npm run set-fx-rate -- 1 <SENDER_ADDRESS> 600000

# Step 3: Execute the atomic swap
npm run execute-payment -- 1
```

### 10. Interactive UI

A web UI for running the full payment flow visually:

```bash
npm run ui
```

Open [http://localhost:3000](http://localhost:3000). The UI shows the three-step flow with live payment status, token balances, and Solana Explorer links for every transaction.

## CLI reference

| Script | Usage |
|---|---|
| `npm run deploy:stablecoin` | `-- <name> <symbol>` -- Deploy a new SPL stablecoin with metadata |
| `npm run deploy:program` | `[buffer_address]` -- Deploy or upgrade the Anchor program via Dfns |
| `npm run mint-tokens` | `-- <mint> <recipient> <amount>` -- Mint tokens to an address |
| `npm run init-payment` | `-- <id> <receiver> <amount>` -- Initialize a payment PDA |
| `npm run set-fx-rate` | `-- <id> <sender> <amount_out>` -- Lock in the FX conversion rate |
| `npm run execute-payment` | `-- <id>` -- Execute the atomic burn/mint swap |
| `npm run ui` | Start the interactive web UI on port 3000 |

## Project structure

```
cross-border-payments-solana/
  programs/cross-border-payment/
    src/lib.rs          # Anchor program (initialize, set_fx_rate, execute)
  dfns/
    DfnsClient.ts       # Dfns SDK setup and env config
    broadcast.ts        # Shared transaction broadcast helper
    deploy-program.ts   # Deploy/upgrade the Anchor program via Dfns
    deploy-stablecoin.ts # Deploy SPL token mints with metadata
    init-payment.ts     # Initialize a payment PDA
    set-fx-rate.ts      # Set the FX rate on a payment
    execute-payment.ts  # Execute the atomic swap
    mint-tokens.ts      # Mint tokens to an address
    server.ts           # Express API server for the web UI
    ui.html             # Interactive web UI (single file, no build step)
  tests/
    cross-border-payment.ts  # Anchor test suite
```
