# X402 AI Agent Payments

Let AI agents pay paywalled APIs autonomously — using a Dfns-secured wallet to sign ERC-3009 pull-payment authorizations, and a second Dfns wallet on the merchant side to broadcast settlement and absorb the gas.

The X402 protocol revives HTTP `402 Payment Required` as the wire format for agent ↔ merchant payments. Dfns is the part that makes it safe: customer keys never leave Dfns infrastructure, policies run **before** signing, and the merchant's facilitator wallet is the only entity authorized to settle (USDC enforces `msg.sender == payee`).

> **Adapted from** [tjdragon/DFNS-X402](https://github.com/tjdragon/DFNS-X402). Built on the [X402 protocol](https://www.x402.org/) and [ERC-3009](https://eips.ethereum.org/EIPS/eip-3009).

## Why Dfns

| Concern | How Dfns covers it |
|---|---|
| **Key management** | The customer's payer key is held in Dfns (MPC/HSM). The agent never sees it. |
| **Pre-sign policy** | An in-process check runs before the SDK call (per-payment cap in this demo). A native Dfns `Wallets:Sign` Policy can run in parallel as defense in depth. |
| **EIP-712 / typed-data signing** | First-class via `wallets.generateSignature` with `kind: 'Eip712'`. No raw-message hacks. |
| **Settlement** | The merchant facilitator broadcasts `receiveWithAuthorization` via `wallets.broadcastTransaction`. Same Dfns API, different wallet. |
| **Gasless agents** | Because settlement is broadcast from the merchant wallet, agents only need to hold the asset they spend. No native ETH on the agent side. |

## Architecture

```
1. Agent     ── GET /item ───────────────────────▶  Merchant
2. Agent     ◀── 402 + PaymentRequirement ───────  Merchant

3. Agent     ── signPayment(req) ────────────────▶  Dfns (Signer)
                                                     ↳ policy: cap, asset, recipient
                                                     ↳ wallets.generateSignature
                                                       (customer wallet · EIP-712)
4. Agent     ◀── EIP-3009 signature ─────────────  Dfns (Signer)

5. Agent     ── GET /item + X-PAYMENT header ────▶  Merchant
                                                     ↳ ethers.verifyTypedData

6. Merchant  ── settle(signed payload) ──────────▶  Dfns (Facilitator)
                                                     ↳ encode receiveWithAuthorization
                                                     ↳ wallets.broadcastTransaction
                                                       (merchant wallet → chain)
7. Agent     ◀── 200 + txHash ───────────────────  Merchant
```

> The two Dfns roles (**Signer** and **Facilitator**) share one Dfns API client in this demo — only the `walletId` changes between calls. In a production split, the Signer runs on the platform that hosts agents and the Facilitator runs on the merchant, each authenticated as its own service account.

### Two Dfns wallets

| Role | Wallet | Responsibility |
|---|---|---|
| **Payer** (customer) | `DFNS_CUSTOMER_WALLET_ID` | Holds USDC. Signs the EIP-712 authorization via `wallets.generateSignature`. Never broadcasts. |
| **Payee + Facilitator** (merchant) | `DFNS_MERCHANT_WALLET_ID` | Verifies the signature, broadcasts `receiveWithAuthorization` via `wallets.broadcastTransaction`, pays gas. Address must equal `MERCHANT_ADDRESS` — USDC enforces `msg.sender == payee`. |

### What the signer enforces

`src/dfns-signer.ts` rejects any payment over **5.00 USDC** before calling `wallets.generateSignature`. Extend the check with whatever your platform needs: agent auth tokens, recipient allowlists, per-merchant caps, time-windowed spend tracking.

For production, pair the in-process check with a native **Dfns Policy** on `Wallets:Sign` covering the customer wallet — that runs server-side at Dfns and can't be bypassed even if your signer service is compromised.

## Tech stack

- **Signing**: Dfns KMS via `@dfns/sdk` + `@dfns/sdk-keysigner` (EIP-712)
- **Settlement**: Dfns `wallets.broadcastTransaction` from the merchant wallet
- **Standard**: ERC-3009 `receiveWithAuthorization` on Circle USDC (`FiatTokenV2`)
- **Runtime**: TypeScript via `ts-node`, `ethers` v6 for ABI encoding and typed-data verification
- **Network**: Ethereum Sepolia (Chain ID `11155111`), USDC at `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`

## Quick start

### 1. Prerequisites

- Node.js v22+
- A [Dfns](https://www.dfns.co/) account with a **service account** holding:
  - `Wallets:GenerateSignature` on the customer wallet
  - `Wallets:BroadcastTransaction` on the merchant wallet
  - `Wallets:Read` on both
- Two Dfns wallets on **Ethereum Sepolia**:
  - A **customer** wallet funded with testnet USDC ([Circle faucet](https://faucet.circle.com/))
  - A **merchant** wallet funded with testnet ETH for gas

### 2. Install

```bash
cd x402-ai-payments
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Fill in your `.env`:

| Variable | Description |
|---|---|
| `DFNS_API_URL` | Dfns API base URL (default `https://api.dfns.io`) |
| `DFNS_ORG_ID` | Your Dfns organization ID |
| `DFNS_AUTH_TOKEN` | Service-account auth token |
| `DFNS_CRED_ID` | Service-account credential ID |
| `DFNS_PRIVATE_KEY` | Service-account private key (PEM) |
| `DFNS_CUSTOMER_WALLET_ID` | Payer wallet — signs the EIP-712 authorization |
| `DFNS_MERCHANT_WALLET_ID` | Payee wallet — broadcasts the settlement |
| `MERCHANT_ADDRESS` | On-chain address of the merchant wallet (must match `DFNS_MERCHANT_WALLET_ID`) |
| `USDC_CONTRACT_ADDRESS` | USDC contract on the target chain |
| `CHAIN_ID` | Numeric chain ID (`11155111` for Sepolia) |

Need to find the wallet IDs?

```bash
npm run wallets:list                  # defaults to EthereumSepolia
npm run wallets:list EthereumSepolia
```

### 4. Run the demo

```bash
npm start
```

You'll see the agent hit a `402`, the Dfns signer produce an EIP-712 signature for `ReceiveWithAuthorization`, the merchant verify it locally with `ethers.verifyTypedData`, and the facilitator broadcast `receiveWithAuthorization` on Sepolia. The console prints the resulting transaction hash — paste it into [sepolia.etherscan.io](https://sepolia.etherscan.io) to confirm settlement.

## Scripts

| Script | Purpose |
|---|---|
| `npm start` | Run the end-to-end X402 demo |
| `npm run wallets:list [network]` | List Dfns wallets for a network (default `EthereumSepolia`) |

## Project structure

```
x402-ai-payments/
├── src/
│   ├── demo.ts          # entrypoint — wires signer + merchant + agent
│   ├── agent.ts         # AI agent: handles 402, requests signature, retries
│   ├── merchant.ts      # merchant API: returns 402, verifies sig, settles
│   ├── dfns-signer.ts   # both Dfns roles — signPayment + settlePayment
│   ├── types.ts         # PaymentRequirement / PaymentSignature shapes
│   └── list-wallets.ts  # helper to find wallet IDs
└── docs/
    └── flow.puml        # PlantUML sequence diagram
```

> The demo wires the agent and the Dfns signer in-process for readability. In production, the signer sits behind an HTTP endpoint that the agent calls — see the `signPayment` method in `dfns-signer.ts` for the request/response shape.

## Adapting

- **Different chain / token**: change `CHAIN_ID` and `USDC_CONTRACT_ADDRESS`. The EIP-712 domain (`name`, `version`) in `merchant.ts` and `dfns-signer.ts` must match the token contract — for non-USDC ERC-3009 tokens, update those fields.
- **Stricter policy**: extend the check in `dfns-signer.ts#signPayment` — per-agent auth tokens, allowlists of merchant addresses, time-windowed spend tracking. Anything that runs before `wallets.generateSignature` is your in-process enforcement point. Layer a Dfns `Wallets:Sign` Policy on top for server-side defense in depth.
- **Real merchant**: replace `merchant.ts` with your own HTTP server. The two contracts it owes the agent are (a) return `402` with a well-formed `PaymentRequirement` and (b) verify the signature and settle on receipt.

## License

MIT
