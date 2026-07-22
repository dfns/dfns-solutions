# X402 Session Payments — Demo

A single-process, single-command demo of session-based x402 payments: one on-chain `approve` opens a bounded envelope (budget / recipients / TTL / per-payment cap), then a sequence of payments settle against it with zero further signatures. Mirrors the structure of the base [`x402-ai-payments`](../../x402-ai-payments) blueprint — same `ts-node src/demo.ts` shape, one `SessionSigner` class instead of a per-payment signer.

> **What this is *not* about.** The point isn't that a Dfns-backed service account can't already run without a human present — it can. The point is bounding what it's allowed to do once it's running: a budget cap, a recipient whitelist, and an expiry, agreed once and enforced on every payment after that.

## Why Dfns

| Concern | How Dfns covers it |
|---|---|
| **Key management** | The customer's and merchant's keys are held in Dfns (MPC/HSM). Neither the agent nor the facilitator process ever sees them. |
| **The one signature** | `openSession()` calls `wallets.broadcastTransaction` once, from the customer wallet, for `approve(spender, budget)`. |
| **Autonomous settlement** | Every payment after that calls `wallets.broadcastTransaction` from the **merchant** wallet for `transferFrom(customer, recipient, amount)` — no customer signature involved. |
| **Pre-broadcast policy** | `SessionSigner.pay()` checks recipient / expiry / per-payment cap / remaining budget in-process before ever calling Dfns. A native Dfns `Wallets:Sign` Policy on either wallet runs in parallel as defense in depth. |
| **On-chain hard cap** | Because the merchant wallet can only ever pull what was approved, the ERC20 contract itself is the backstop — even a fully compromised session-signer process cannot move more than the approved budget. |

## Architecture

```
1. Agent    ── openSession(budget, recipients, ttl) ──▶ SessionSigner
                                                          ↳ wallets.broadcastTransaction
                                                            approve(merchant, budget)
                                                            (customer wallet · ONE signature)
2. Agent    ◀── sessionId ─────────────────────────────  SessionSigner

3. Agent    ── GET /item ──────────────────────────────▶ Merchant
4. Agent    ◀── 402 + PaymentRequirement ──────────────  Merchant

5. Agent    ── pay(sessionId, item, price) ────────────▶ SessionSigner
                                                          ↳ policy: budget, recipient, expiry, cap
                                                          ↳ wallets.broadcastTransaction
                                                            transferFrom(customer, merchant, price)
                                                            (merchant wallet · no new signature)
6. Agent    ◀── txHash ────────────────────────────────  SessionSigner

7. Agent    ── GET /item (paid) ───────────────────────▶ Merchant
8. Agent    ◀── 200 OK ────────────────────────────────  Merchant

    ... repeat 3–8 for every message/tool-call/API-hit in the session, no signing ...

9. Agent    ── closeSession() ─────────────────────────▶ SessionSigner
10. Agent   ◀── receipt (total spent, remaining) ──────  SessionSigner
```

### Two Dfns wallets, two roles

| Role | Wallet | Responsibility |
|---|---|---|
| **Payer** (customer) | `DFNS_CUSTOMER_WALLET_ID` | Holds USDC. Broadcasts the **one** `approve(spender, budget)` call that opens the session. Never called again for the rest of the session. |
| **Payee + Facilitator/spender** (merchant) | `DFNS_MERCHANT_WALLET_ID` | The ERC20 `spender` approved above. Broadcasts `transferFrom(customer, merchant, amount)` for every payment. Address must equal `MERCHANT_ADDRESS`. |

### What the session signer enforces (`src/session-signer.ts`)

Before broadcasting any `transferFrom`, `pay()` checks, in order: session not closed → not expired → recipient in the approved list → amount within the per-payment cap → amount within remaining budget. Any failure throws without touching the chain. The demo (`src/demo.ts`) deliberately sends a message that blows the budget, one that blows the per-payment cap, and a payment to an unapproved recipient, so you can see all three denials fire.

## Tech stack

- **Signing/settlement**: Dfns KMS via `@dfns/sdk` + `@dfns/sdk-keysigner`, `wallets.broadcastTransaction` for both `approve` and `transferFrom`
- **Standard**: ERC20 `approve` / `transferFrom` on Circle USDC, broadcast from Dfns-custodied wallets
- **Runtime**: TypeScript via `ts-node`, `ethers` v6 for ABI encoding
- **Network**: Base Sepolia (Chain ID `84532`), USDC at `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

## Quick start

### 1. Prerequisites

- Node.js v22+
- A [Dfns](https://www.dfns.co/) account with a **service account** holding `Wallets:GenerateSignature`, `Wallets:BroadcastTransaction`, and `Wallets:Read` on both wallets below
- Two Dfns wallets on **Base Sepolia**:
  - A **customer** wallet funded with testnet USDC ([Circle faucet](https://faucet.circle.com), select Base Sepolia) and Base Sepolia ETH for the `approve` gas
  - A **merchant** wallet funded with Base Sepolia ETH (it pays gas for every `transferFrom`)

### 2. Install

```bash
cd app
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `DFNS_API_URL` / `DFNS_ORG_ID` / `DFNS_AUTH_TOKEN` / `DFNS_CRED_ID` / `DFNS_PRIVATE_KEY` | Service-account credentials |
| `DFNS_CUSTOMER_WALLET_ID` | Payer wallet — broadcasts the one-time `approve` |
| `DFNS_MERCHANT_WALLET_ID` | Payee/spender wallet — broadcasts every `transferFrom` |
| `MERCHANT_ADDRESS` | On-chain address of the merchant wallet (must match `DFNS_MERCHANT_WALLET_ID`) |
| `USDC_CONTRACT_ADDRESS` | USDC contract on the target chain (default: Base Sepolia) |
| `CHAIN_ID` | Numeric chain ID (`84532` for Base Sepolia) |

Need wallet IDs?

```bash
npm run wallets:list                # defaults to BaseSepolia
npm run wallets:list BaseSepolia
```

### 4. Run the demo

```bash
npm start
```

You'll see: one `approve` broadcast opening the session, three payments settle automatically, one denial for exceeding the remaining budget, one for exceeding the per-payment cap, and one for an unapproved recipient — then a closing receipt. Paste any printed tx hash into [sepolia.basescan.org](https://sepolia.basescan.org) to confirm on-chain.

## Project structure

```
app/
└── src/
    ├── demo.ts            # entrypoint — opens a session, sends messages, closes it
    ├── agent.ts           # drives the 402 → pay → retry loop per message
    ├── merchant.ts        # returns 402, asks the signer to settle
    ├── session-signer.ts  # openSession (approve) + pay (check + transferFrom) + closeSession
    ├── types.ts           # SessionConfig / OpenedSession / SessionReceipt shapes
    └── list-wallets.ts    # helper to find wallet IDs
```

## Adapting

- **Different chain / token**: change `CHAIN_ID` and `USDC_CONTRACT_ADDRESS`. Any ERC20 with standard `approve`/`transferFrom` works — no EIP-712 domain to keep in sync, unlike the base blueprint's EIP-3009 flow.
- **Stricter policy**: extend the checks in `session-signer.ts#pay` — per-agent auth tokens, time-windowed spend velocity limits, multiple concurrent sessions per customer. Layer a Dfns `Wallets:Sign` Policy on top for server-side defense in depth.
- **Real merchant / real facilitator surface**: see the [`facilitator/`](../facilitator) package for the same mechanism exposed over the standard x402 HTTP API (`/supported`, `/verify`, `/settle`, `/sessions`).
- **Want to *see* it instead of reading console output?** See [`frontend/`](./frontend) — a Next.js slot machine demo calling the standalone [`facilitator/`](../facilitator) over HTTP, using this exact mechanism (one on-chain `approve`, then a `transferFrom` per lever pull).

## License

MIT
