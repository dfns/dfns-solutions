# Crypto Payroll

Send USDC salaries to employees in bulk with policy-gated approvals — using a [Dfns](https://www.dfns.co) treasury wallet for key management and the Dfns Policy Engine to enforce spending controls.

Every payroll run reads a CSV of employees and amounts, initiates the USDC transfers, and routes them through a policy. A Dfns Service Account (the **checker**) auto-approves transfers within the configured limit. Transfers above the limit sit `Pending` until a human approver accepts or rejects them — giving finance teams a clear maker/checker workflow without building approval infrastructure from scratch.

> **Full tutorial:** [docs.dfns.co/solutions/automate-payments](https://docs.dfns.co/solutions/automate-payments)

## Why Dfns

| Concern | How Dfns covers it |
|---|---|
| **Key security** | The treasury private key is held in Dfns MPC/HSM. No key ever touches your payroll server. |
| **Spending controls** | A `Wallets:Sign` policy intercepts every transfer. The checker auto-approves small amounts; large transfers require human sign-off. |
| **Maker / checker** | The service account that runs payroll cannot approve its own transactions in production (`initiatorCanApprove: false`). |
| **Idempotency** | Each transfer carries an `externalId` derived from the payroll run date and employee address. Re-running the same payroll will not double-pay. |
| **Audit trail** | Every approval decision — who approved, when, with what reason — is recorded by Dfns and queryable via API. |

## Architecture

```
   Finance team                 Dfns Policy Engine           Service Account (checker)
        |                               |                              |
        |-- npm run payroll:run ------->|                              |
        |   (CSV: 5 employees · USDC)  |                              |
        |                              |                              |
        |                              |-- approval Pending --------->|
        |                              |   (for each transfer)        | listApprovals()
        |                              |                              | amount <= 1 000 USDC?
        |                              |<-- createApprovalDecision ---|
        |                              |    Approved / left Pending   |
        |                              |                              |
        |<-- transfer broadcasts ------|                              |
        |   (small amounts auto-done)  |                              |
        |                              |                              |
   Human approver                      |                              |
        |-- npm run approvals:approve ->|                             |
        |   (for large amounts)        |                              |
        |<-- transfer broadcasts ------|                              |
```

### Two roles

| Role | Identity | Responsibility |
|---|---|---|
| **Maker** | Treasury wallet (`TREASURY_WALLET_ID`) | Holds USDC. Initiates transfers via `wallets.transferAsset`. |
| **Checker** | Service account (credentials in `.env`) | Runs `approvals:auto` to approve or leave transfers for human review. |

### Policy rules

The policy created by `npm run policy:create` triggers on every `Wallets:Sign` operation from the treasury wallet (filtered by the `payroll` tag). The checker enforces two rules:

1. **Contract check** — denies any transfer not targeting the configured USDC contract.
2. **Amount threshold** — auto-approves transfers ≤ `AUTO_APPROVE_LIMIT_USDC`; leaves larger ones `Pending` for human review.

## Tech stack

- **Transfers**: Dfns `wallets.transferAsset` with `kind: Erc20`
- **Policies**: Dfns Policy Engine — `Wallets:Sign` + `AlwaysTrigger` + approval groups
- **Scripts**: TypeScript via `tsx`, `viem` for amount parsing
- **Network**: Ethereum Sepolia (Chain ID `11155111`), USDC at `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`

## Quick start

### 1. Prerequisites

- Node.js v22+
- A [Dfns](https://www.dfns.co/) account with:
  - A **service account** with `Wallets:TransferAsset` and `Policies:Read` / `Policies:Write` permissions
  - A **treasury wallet** on Ethereum Sepolia funded with testnet USDC ([Circle faucet](https://faucet.circle.com/))
  - A **user** to act as human approver on the policy

### 2. Install

```bash
cd crypto-payroll
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Fill in your `.env`:

| Variable | Description |
|---|---|
| `DFNS_API_URL` | Dfns API base URL (default: `https://api.dfns.io`) |
| `DFNS_ORG_ID` | Your Dfns organization ID |
| `DFNS_AUTH_TOKEN` | Service account auth token |
| `DFNS_CRED_ID` | Service account credential ID |
| `DFNS_PRIVATE_KEY` | Service account private key (PEM) |
| `TREASURY_WALLET_ID` | Wallet that holds payroll funds — tag it `payroll` in the Dfns dashboard |
| `POLICY_USER_ID` | User ID of the human approver — run `npm run users:list` to find it |
| `AUTO_APPROVE_LIMIT_USDC` | Transfers at or below this amount (in USDC) are auto-approved (default: `1000`) |
| `USDC_CONTRACT` | USDC contract address (default: Sepolia USDC) |

> **Whose credentials go in `.env`?** The service account — the checker. The treasury wallet is identified only by `TREASURY_WALLET_ID`. Tag it `payroll` in the Dfns dashboard so the policy filter picks it up.

### 4. Find your user ID

```bash
npm run users:list
```

Copy the `userId` of the intended human approver into `.env` as `POLICY_USER_ID`.

### 5. Create the policy

```bash
npm run policy:create
```

Creates a `Wallets:Sign` policy that intercepts all transfers from the tagged treasury wallet.

> **Tag the treasury wallet.** In the Dfns dashboard, add the tag `payroll` to `TREASURY_WALLET_ID` — the policy filter targets wallets with this tag.

### 6. Edit the payroll CSV

Open `data/employees.csv` and replace the sample entries with your employees:

```csv
name,address,amount_usdc
Alice Chen,0x...,500
Bob Martin,0x...,12000
```

### 7. Run payroll

```bash
npm run payroll:run
```

Sends a USDC transfer for each employee. The policy intercepts every transfer and puts it in `Pending`.

### 8. Process approvals

Let the service account auto-approve transfers within the limit:

```bash
npm run approvals:auto
```

Check what needs human review:

```bash
npm run approvals:list
```

Approve or reject large transfers manually:

```bash
npm run approvals:approve <approvalId>
npm run approvals:reject <approvalId>
```

Check final transfer statuses:

```bash
npm run status
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run policy:create` | Create the payroll approval policy in Dfns |
| `npm run payroll:run` | Send USDC to every employee in `data/employees.csv` |
| `npm run approvals:list` | List pending transfers waiting for human review |
| `npm run approvals:auto` | Service-account checker: auto-approve small, leave large |
| `npm run approvals:approve <id>` | Manually approve a flagged transfer |
| `npm run approvals:reject <id>` | Manually reject a flagged transfer |
| `npm run status` | Show recent transfer statuses from the treasury wallet |
| `npm run users:list` | List org users and service accounts (find `POLICY_USER_ID`) |

## Project structure

```
crypto-payroll/
├── scripts/
│   ├── DfnsCommon.ts     # shared Dfns client and env config
│   ├── Setup.ts          # create the Wallets:Sign approval policy
│   ├── RunPayroll.ts     # read CSV and initiate USDC transfers
│   ├── AutoReview.ts     # service-account checker: approve or flag
│   ├── ListPending.ts    # list transfers pending human review
│   ├── Approve.ts        # manually approve a transfer
│   ├── Reject.ts         # manually reject a transfer
│   ├── Status.ts         # show recent transfer statuses
│   └── ListUsers.ts      # list users to find POLICY_USER_ID
└── data/
    └── employees.csv     # payroll input: name, address, amount_usdc
```

## Adapting

- **Different token**: change `USDC_CONTRACT` in `.env` and the `kind` field in `RunPayroll.ts` (e.g. `Erc20` stays the same, just point at a different contract).
- **Different threshold**: update `AUTO_APPROVE_LIMIT_USDC` in `.env` — no code change needed.
- **Stricter approval**: set `initiatorCanApprove: false` in `Setup.ts` so the service account that runs payroll cannot approve its own transactions.
- **Multiple approvers**: add more user IDs to the `approvers.userId.in` array in `Setup.ts` and raise the `quorum`.
- **Scheduled runs**: invoke `npm run payroll:run && npm run approvals:auto` from a cron job or your CI/CD pipeline.

## License

MIT
