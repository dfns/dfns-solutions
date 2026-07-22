# X402 Session Payments — Slot Demo (Next.js)

A visual, interactive version of the same session mechanism as [`../src`](../src): a slot machine you authorize once and then pull the lever on repeatedly, each pull settling for real over ERC20 `transferFrom` on Base Sepolia — but here the customer side connects a real browser wallet (MetaMask, or anything else) instead of being Dfns-custodied.

## Architecture: MetaMask customer + Dfns merchant

- **Connect Wallet** — the player connects their own wallet via the browser's injected provider (`window.ethereum`). No wagmi/viem; just the raw EIP-1193 calls in [`lib/wallet.ts`](./lib/wallet.ts).
- **Authorize Session** — the player's wallet signs and submits the one ERC20 `approve(spender=merchant, budget)` directly. This app waits for it to be mined, then calls its own `POST /api/session/open`, which forwards the tx hash to the standalone [`facilitator/`](../../facilitator) — the facilitator verifies the tx on-chain (target contract, spender, value, live allowance) before opening the session.
- **Pull Lever** — calls `POST /api/pull`, which forwards to the facilitator's `POST /settle`. The facilitator checks the session envelope (budget / recipient / expiry / per-pull cap) and, if it holds, broadcasts `transferFrom(customer, merchant, price)` from its **Dfns-custodied merchant wallet**. No further signature is ever requested from the player.
- This app holds **no Dfns credentials at all** — only the facilitator does, for the merchant/spender side.

Same trust model as the rest of this blueprint: the ERC20 allowance is the on-chain hard cap; recipient/expiry/per-pull limits are enforced by the facilitator before it ever calls Dfns.

> Want both sides Dfns-custodied instead (no browser wallet at all — e.g. an autonomous agent controlling its own funds)? See [`../src`](../src), the plain console demo.

## Setup

This app is a thin client — it needs the facilitator running first, and a browser wallet (e.g. MetaMask) funded with Base Sepolia ETH + USDC.

```bash
# 1. In one terminal: start the facilitator (see ../../facilitator/README.md)
cd ../../facilitator
npm install && cp .env.example .env   # fill in Dfns credentials + DFNS_MERCHANT_WALLET_ID
npm run dev                            # listens on :4021

# 2. In another terminal: start this app
cd app/frontend
npm install
cp .env.example .env.local             # point FACILITATOR_URL + NEXT_PUBLIC_MERCHANT_ADDRESS at the service above
npm run dev                            # listens on :3000
```

Open `http://localhost:3000` — the landing page links to `/slot`, the actual game. Connect a wallet, pick a budget, approve, then pull.

The Dfns merchant wallet (configured on the facilitator) needs Base Sepolia ETH for gas. Your own wallet needs Base Sepolia USDC ([Circle faucet](https://faucet.circle.com)) and ETH for the one `approve`.

## Pages & routes

| Path | Purpose |
|---|---|
| `/` | Landing page — explains the mechanism, links to the demo |
| `/slot` | The slot machine — connect a wallet, authorize a session, pull the lever, watch the budget and stats update live |
| `POST /api/session/open` | Forwards a client-submitted approve tx hash to facilitator `POST /sessions` for verification |
| `POST /api/pull` | Forwards to facilitator `POST /settle` — envelope check + Dfns `transferFrom` + spins the reels |
| `POST /api/session/close` | Forwards to facilitator `POST /sessions/:id/close` |

## Project structure

```
frontend/
├── app/
│   ├── layout.tsx        # root layout — renders the shared Header
│   ├── page.tsx           # landing page
│   ├── globals.css        # shared dark theme
│   ├── slot/page.tsx       # the slot machine (client component) — wallet connect + game
│   └── api/
│       ├── session/open/route.ts   # POST — proxies facilitator /sessions
│       ├── session/close/route.ts  # POST — proxies facilitator /sessions/:id/close
│       └── pull/route.ts            # POST — proxies facilitator /settle + spins reels
├── components/
│   └── Header.tsx          # floating nav, active-link highlighting
└── lib/
    ├── wallet.ts            # minimal EIP-1193 helpers — connect, approve, wait for receipt
    └── reel.ts               # weighted reel table for the slot game
```

## Env vars

| Variable | Description |
|---|---|
| `FACILITATOR_URL` | Base URL of the standalone facilitator (default `http://localhost:4021`) |
| `NETWORK` | Network string sent in `paymentRequirements` to `/settle` (default `base:sepolia`) |
| `NEXT_PUBLIC_MERCHANT_ADDRESS` | The session's sole recipient and ERC20 approve `spender` — must match the facilitator's Dfns merchant wallet. Client-visible because the browser builds the approve tx. |
| `NEXT_PUBLIC_USDC_CONTRACT_ADDRESS` | USDC contract on the target chain — also needed client-side to send the approve tx |
| `PER_PULL_BASE_UNITS` | Price per lever pull, in USDC base units (default `100000` = 0.10 USDC) — must be within the facilitator's `maxPerCall` |

No `DFNS_*` variables here — this app never talks to Dfns directly.

## Related

- [`../src`](../src) — the fully-Dfns-custodied version of this mechanism (no browser wallet at all), as a plain console demo
- [`../../facilitator`](../../facilitator) — the standalone HTTP facilitator this app calls for every session operation

## License

MIT
