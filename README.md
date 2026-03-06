# Dfns Solution Blueprints

Production-ready code examples and step-by-step tutorials that show you how to build real-world applications with [Dfns](https://www.dfns.co).

Dfns provides institutional-grade key management and wallet infrastructure. Solution blueprints help you go from **evaluating Dfns** to **running your first app** as fast as possible:

- **Ready-to-go use cases** — each solution blueprint implements a concrete business scenario you can explore, demo, or pitch to your team
- **Code you can run today** — clone, configure your Dfns credentials, and have a working app in minutes
- **Clear architecture** — every blueprint explains where each piece lives so you can lift what you need into your own application

## Solution Blueprints

### Stablecoin Issuance & Management

Deploy and manage your own ERC-20 stablecoin on Ethereum (Sepolia testnet) using Dfns wallets. Mint, burn, pause, and unpause tokens through an interactive CLI.

**Business use case:** Financial institutions and fintechs that need to issue and control a branded stablecoin with enterprise-grade key security.

[Get started &rarr;](./stablecoin-management/)

### Cross-Border Payments with FX Settlement

Process cross-border payments between two stablecoins (e.g. iEUR &rarr; iAUD) using an on-chain settlement contract and FX provider workflow.

**Business use case:** Payment processors and banks looking to settle international transfers on-chain with transparent FX conversion and full audit trail.

[Get started &rarr;](./cross-border-payments/)

### Cross-Border Payments on Solana

Atomic stablecoin swap on Solana — burn tEUR from the sender and mint tSGD to the receiver in a single transaction using an Anchor program and Dfns KMS signing. Includes an interactive web UI.

**Business use case:** Fintechs and remittance providers building on Solana who need atomic FX settlement with institutional key management.

[Get started &rarr;](./cross-border-payments-solana/)

### Bond Issuance

Tokenized corporate bond lifecycle on Ethereum — investors subscribe with stablecoins, receive ERC-20 bond tokens, collect periodic coupon payments, and redeem principal at maturity. Includes a web UI with split Issuer/Investor dashboards.

**Business use case:** Asset managers and capital markets teams looking to issue, manage, and settle tokenized bonds on-chain with institutional key custody.

[Get started &rarr;](./bond-issuance/)

### Bank Custody Platform

Full-stack web application where crypto wallets sit alongside traditional fiat accounts — same look, same feel. Dfns powers the crypto side invisibly; customers never know it exists. Includes family delegation (parents share wallet access with kids, with per-person transfer limits) and a bank employee approval workflow.

**Business use case:** Banks and neobanks looking to offer crypto custody to retail customers with institutional-grade key security, configurable approval policies, and family account sharing.

[Get started &rarr;](./bank-custody/)

## Getting Started

Pick a solution blueprint, open its folder, and follow the README — each one walks you through setup and running the app end to end.

You'll need a Dfns account and API credentials. If you don't have one yet, sign up at [https://app.dfns.io/get-started](https://app.dfns.io/get-started).

## Documentation

Full tutorials available at [docs.dfns.co/solutions](https://docs.dfns.co/solutions).

## Contributing

Have a use case you'd like to see? Open an issue or submit a PR. Each solution blueprint should include:

- A clear explanation of the business use case it solves
- Code that runs without modifications (given valid credentials)
- A step-by-step tutorial in the blueprint README
- A description of the project structure so developers can reuse the code
