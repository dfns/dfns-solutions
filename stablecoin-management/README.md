# Dfns Stablecoin Management

Deploy and manage an ERC-20 stablecoin with mint, burn, and pause controls using [Dfns](https://www.dfns.co) wallets.

Stablecoin issuers need to deploy a token contract, mint and burn supply, and freeze transfers in emergencies — all while keeping signing keys secure. This solution blueprint shows how to do that with Dfns wallets handling the key management and transaction signing.

> **Full tutorial:** [docs.dfns.co/solutions/stablecoin-management](https://docs.dfns.co/solutions/stablecoin-management)

## Quick start

### 1. Configure environment

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `DFNS_API_URL` | Dfns API base URL (default: `https://api.dfns.io`) |
| `DFNS_ORG_ID` | Your Dfns organization ID |
| `DFNS_AUTH_TOKEN` | Service account auth token from Dfns dashboard |
| `DFNS_CRED_ID` | Credential ID for the signing key |
| `DFNS_PRIVATE_KEY` | Private key (PEM format) for signing requests |
| `BANK_WALLET_ID` | Dfns wallet ID that will own and operate the stablecoin |
| `BLOCKCHAIN_RPC_URL` | RPC endpoint (default: Sepolia public RPC) |

### 2. Install and compile

```bash
npm install
npx hardhat compile
```

### 3. Deploy

```bash
npm run deploy
```

Deploys an ERC-20 stablecoin ("Bank AUD" / `bAUD`) owned by the `BANK_WALLET_ID` wallet. The script prints the contract address.

### 4. Manage

```bash
npm run ops <contractAddress>
```

Interactive CLI for minting, burning, pausing, and unpausing the stablecoin. The token uses 6 decimals — to mint 100 tokens, enter `100000000`.
