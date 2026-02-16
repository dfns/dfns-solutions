# Dfns Cross-Border Payments

Process cross-border payments with FX conversion between stablecoins using [Dfns](https://www.dfns.co) wallets.

International payments require burning a source currency, applying an exchange rate, and minting the destination currency to the receiver — coordinating multiple actors (bank, sender, FX provider) across each step. This solution blueprint shows how to orchestrate that flow on-chain with Dfns wallets handling the key management and transaction signing.

> **Full tutorial:** [docs.dfns.co/solutions/cross-border-payments](https://docs.dfns.co/solutions/cross-border-payments)

## Quick start

### 1. Configure environment

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

## CLI reference

| CLI | Usage |
|---|---|
| `npm run sender-cli init` | `init <cbpAddress> <iEurAddress> <receiverAddress> <amount>` — Initiate a payment |
| `npm run sender-cli execute` | `execute <cbpAddress> <paymentId>` — Execute a payment after FX rate is set |
| `npm run fx-cli set-rate` | `set-rate <cbpAddress> <paymentId> <amount>` — Set the iAUD conversion amount |
| `npm run receiver-cli grantRole` | `grantRole <roleName> <contractAddress> <accountAddress>` — Grant a role on a contract |
