# X402 Session Payments

Bounded delegation for x402: authorize a budget once, then let payments flow autonomously within budget / recipient / TTL bounds — no fresh signature per payment.

> **Framing note.** This blueprint is not about removing human signatures — a Dfns-backed service account can already sign autonomously. It's about giving that autonomy a hard **enforcement envelope**: a budget cap, a recipient whitelist, and an expiry, agreed once and enforced on every subsequent payment. That's what turns "the service account can sign anything" into "the service account can sign *this much, to these parties, until this time*."

## Demo status

Everything below is implemented and has been verified end-to-end on Base Sepolia — real transactions, not a simulation:

- **`app/`** (console demo) implements the fully-Dfns-custodied design as written: both the customer's `approve` and the merchant's `transferFrom` broadcast via Dfns. This is the reference path this blueprint is meant to demonstrate.
- **`app/frontend/`** + **`facilitator/`** (`LOCAL_MODE`) were exercised live using MetaMask for the customer side (a real wallet signing a real `approve`) plus a throwaway local key standing in for the merchant side — since reviewing this PR shouldn't require a Dfns account. Both settlement transactions and the session-opening approve are real, confirmed on-chain (see `facilitator/README.md` → "Local testing without Dfns" for the exact toggle: `LOCAL_MODE` + `MERCHANT_PRIVATE_KEY`). Swapping in real Dfns credentials for `DFNS_MERCHANT_WALLET_ID` requires no code changes — the facilitator already defaults to Dfns whenever `LOCAL_MODE` is unset.
- Along the way, this surfaced and fixed a real interoperability bug worth calling out: MetaMask's newer "smart account" feature routes transactions through its own delegation contract rather than sending directly to the target contract, which broke a naive `tx.to`/`tx.from` check. The facilitator now verifies the actual `Approval` event the ERC20 contract emits instead, which is correct for both plain EOAs and smart accounts.

## The problem this solves

The base [`x402-ai-payments`](../x402-ai-payments) blueprint signs a fresh EIP-3009 authorization for every payment — correct for a one-off API call, but each payment still has to independently justify itself. That's friction for:

- A chatbot conversation where every message triggers a payment
- An agent pipeline making continuous micropayments to APIs, tools, and data providers over a long run
- Metered/streaming billing (pay-per-second, pay-per-token)

Session payments introduce a delegation boundary above the payment layer: authorize the envelope once, then let individual payments clear against it automatically.

## How it works

```
User / Agent                 Session Signer (Dfns)            Merchant / Facilitator
     |                              |                                  |
     |-- openSession(budget, ---->|                                  |
     |   recipients, ttl)          | Dfns wallet broadcasts ONE       |
     |                             | ERC20 approve(spender, budget)   |
     |<-- sessionId ---------------|   (the on-chain root of trust)   |
     |                              |                                  |
     |-- GET /api/item ----------------------------------------------->|
     |<-- 402 + PaymentRequirement -------------------------------------|
     |                              |                                  |
     |-- pay(sessionId, req) ----->|                                  |
     |                              | budget remaining? recipient      |
     |                              | allowed? session expired?        |
     |                              | per-call cap ok?                 |
     |                              |--> wallets.broadcastTransaction  |
     |                              |    transferFrom(user, to, amt)   |
     |                              |    from the MERCHANT wallet      |
     |<-- 200 OK + txHash ------------------------------------------->|
     |                              |                                  |
     |   ... 49 more payments, no signature and no user interaction ...|
     |                              |                                  |
     |-- closeSession() ----------->|                                  |
     |<-- receipt (total spent, ---|                                  |
     |    remaining budget released)|                                  |
```

The key mechanism: the customer's wallet signs **one** ERC20 `approve(spender, budget)` call. Every payment after that is a `transferFrom(user, recipient, amount)` broadcast from the **merchant/facilitator** wallet — the customer is never asked to sign again. The ERC20 contract itself enforces the allowance; nothing downstream can move more than what was approved, no matter what the off-chain bookkeeping says.

## Trust model — what's enforced where

| Bound | Enforced by | Hardness |
|---|---|---|
| **Total budget** | ERC20 `approve` + `transferFrom` — the token contract reverts past the allowance | **On-chain** |
| **Recipient whitelist** | Session signer checks `payTo` against the approved list before broadcasting `transferFrom` | Off-chain (in-process / Dfns Policy) |
| **Expiry (TTL)** | Session signer refuses to broadcast past `expiresAt` | Off-chain (in-process / Dfns Policy) |
| **Per-payment cap** | Session signer refuses any single payment above the configured floor | Off-chain (in-process / Dfns Policy) |
| **Unused balance** | Never escrowed — stays in the customer's wallet until spent | **Native** |

Pair the in-process checks with a Dfns `Wallets:Sign` Policy on both wallets for server-side enforcement that holds even if this service itself is compromised: the customer wallet's policy can bound the `approve` amount, and the merchant wallet's policy can bound `transferFrom` recipients/amounts — defense in depth on top of the ERC20 allowance.

## What's in this blueprint

| Path | Purpose |
|---|---|
| [`app/`](./app) | Self-contained, single-process demo — mirrors `x402-ai-payments`'s style (`SessionSigner` class + `ts-node src/demo.ts`). Both the customer and merchant wallets are Dfns-custodied; good for understanding the mechanism end-to-end with one command and no browser wallet involved. |
| [`app/frontend/`](./app/frontend) | A visual Next.js demo — the same mechanism behind a slot machine you can actually play in a browser. Calls the standalone `facilitator/` over HTTP. The customer side connects a browser wallet (e.g. MetaMask) to sign the one approve; the merchant/spender side stays Dfns-custodied. |
| [`facilitator/`](./facilitator) | An actual HTTP facilitator service (`/supported`, `/verify`, `/settle`, `/sessions`) backed by a Dfns merchant wallet instead of a raw private key — the x402-spec-shaped surface a real resource server would talk to. Verifies a client-submitted approve tx on-chain rather than broadcasting it itself. |

Both target **Base Sepolia** (chainId `84532`, Circle USDC at `0x036CbD53842c5426634e7929541eC2318f3dCF7e`).

## Related

- Builds on: [`x402-ai-payments`](../x402-ai-payments)
- Dfns features used: `wallets.broadcastTransaction` (ERC20 `approve` + `transferFrom`) + Policy Engine (`Wallets:Sign`)
- Protocol: [x402](https://www.x402.org/), scheme `session` (alongside the standard `exact` scheme)
- Discussion: dfns/dfns-solutions issue #6

## License

MIT
