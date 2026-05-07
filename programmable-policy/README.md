# Programmable Policy

Decode pending smart-contract calls and approve or deny them against custom business rules — using a Dfns Service Account as an automated checker on top of a Dfns Policy.

A user (the **Maker**) broadcasts a transaction from a Dfns wallet. A Dfns Policy intercepts the request and puts it in `Pending`. A Dfns **Service Account** (the **Checker**) decodes the ABI-encoded call data, evaluates the function name, recipient and amount against business rules, and posts an `Approved` or `Denied` decision. The transaction only broadcasts after the checker approves.

Static policies decide on amounts and addresses. Smart-contract calls need more: the meaning of the transaction is encoded in ABI-packed call data, not in `value` or `to`. Decoding the call lets the checker enforce per-function rules in plain TypeScript.

> **Full tutorial:** [docs.dfns.co/solutions/build-programmable-approval-policies](https://docs.dfns.co/solutions/build-programmable-approval-policies)

## Architecture

```
   Maker (Dfns user)               Dfns Policy Engine            Checker (Service Account)
        |                                  |                              |
        |-- broadcastTransaction --------->|                              |
        |   (mint(0xRecipient, 9_000_000)) |                              |
        |                                  |                              |
        |                                  |-- approval Pending --------->|
        |                                  |                              | listApprovals()
        |                                  |                              | decodeFunctionData()
        |                                  |                              |   functionName == 'mint' ?
        |                                  |                              |   recipient whitelisted ?
        |                                  |                              |   amount <= cap ?
        |                                  |<-- createApprovalDecision ---|
        |                                  |    Approved / Denied         |
        |                                  |                              |
        |<-- transaction broadcasts -------|                              |
            (or stays Denied)
```

### What the service account checks

`scripts/SCApproveOrReject.ts` enforces three rules in order:

1. **Target contract** — `requestBody.to` must equal `CONTRACT_ADDRESS`.
2. **Function name** — only `mint(address,uint256)` is allowed; any other selector is denied.
3. **Arguments** — recipient must equal `WHITELIST_ADDRESS`, and amount must be ≤ `MAX_MINT_AMOUNT` (10,000,000 base units).

Anything that fails a check is denied with a reason string that lands on the approval record in Dfns.

## Tech stack

- **Contract**: Solidity 0.8.28 ERC-20 with mint/burn/pause (OpenZeppelin)
- **Signing**: Dfns KMS via `@dfns/sdk` + `@dfns/sdk-keysigner`
- **Scripts**: TypeScript (tsx, viem)
- **Network**: Ethereum Sepolia

## Quick start

### 1. Prerequisites

- Node.js v22+
- A [Dfns](https://www.dfns.co/) account with API credentials
- A Dfns wallet on Ethereum Sepolia (the **Maker** wallet)
- A Dfns **Service Account** (the **Checker**) with its own credentials
- A Dfns **User** listed as approver on the policy (alongside the service account)

### 2. Install

```bash
cd programmable-policy
npm install
```

### 3. Compile the contract

```bash
npm run compile
```

### 4. Configure environment

```bash
cp .env.example .env
```

Fill in your `.env`:

| Variable | Description |
|---|---|
| `DFNS_API_URL` | Dfns API base URL (default: `https://api.dfns.io`) |
| `DFNS_ORG_ID` | Your Dfns organization ID |
| `DFNS_AUTH_TOKEN` | Auth token for the **service account** (the checker) |
| `DFNS_CRED_ID` | Credential ID for the service account's signing key |
| `DFNS_PRIVATE_KEY` | Private key (PEM) for the service account |
| `SENDER_WALLET_ID` | Maker wallet that broadcasts the contract calls |
| `POLICY_USER_ID` | User ID listed as a human approver on the policy |
| `CONTRACT_ADDRESS` | StableCoin address (filled in after step 5) |
| `WHITELIST_ADDRESS` | Address allowed as `mint` recipient |

> **Important — whose credentials go in `.env`?** The scripts in this repo run *as the service account* — the checker. The `DFNS_*` variables identify the service account, not the maker. The maker is identified only by `SENDER_WALLET_ID`, the wallet whose pending requests the service account will inspect.

### 5. Deploy the StableCoin

```bash
npm run deploy
```

You'll be prompted for the token name and symbol. The script broadcasts the deployment from `SENDER_WALLET_ID` and prints the deployed contract address. Copy it into `.env` as `CONTRACT_ADDRESS`.

> **Tag the maker wallet.** Add the tag `autoreview` (or whatever you choose — see the `walletTags` filter in `scripts/CreatePolicy.ts`) to `SENDER_WALLET_ID` in the Dfns dashboard, otherwise the policy won't trigger on its transactions.

### 6. Create the policy

```bash
npm run policy:create
```

This creates a `Wallets:Sign` policy with `AlwaysTrigger`, an approval group requiring quorum 1, and `serviceAccountsCanApprove: true`. Both the user (`POLICY_USER_ID`) and the service account can approve.

> **Production best practice.** The policy is created with `initiatorCanApprove: true` so you can demo end-to-end with a single identity. In production set this to `false` so the maker cannot approve their own transaction.

### 7. Trigger a mint and let the service account decide

In one terminal, broadcast a mint as the maker:

```bash
npm run mint -- 0xYourWhitelistedAddress 100
```

The transaction will sit in `Pending` because the policy fired. List it:

```bash
npm run approvals:list
```

Run the automated checker:

```bash
npm run approvals:auto
```

You should see the script decode the `mint` call, log the rule evaluation, and post an `Approved` decision to Dfns. The transaction then broadcasts.

To see denials in action, try:

```bash
npm run mint -- 0x0000000000000000000000000000000000000001 100   # not whitelisted
npm run mint -- 0xYourWhitelistedAddress 999999999                # over the cap
```

Then run `npm run approvals:auto` again — both should be denied with explanatory reasons.

## Scripts

| Script | Purpose |
|---|---|
| `npm run compile` | Compile `StableCoin.sol` |
| `npm run deploy` | Deploy the StableCoin from the maker wallet |
| `npm run mint -- <to> <amount>` | Broadcast a `mint` call (will land in `Pending`) |
| `npm run policy:create` | Create the `Wallets:Sign` approval policy |
| `npm run policy:list` | List existing policies |
| `npm run users:list` | List org users + service accounts (find `POLICY_USER_ID`) |
| `npm run approvals:list` | List pending approvals for the maker wallet |
| `npm run approvals:auto` | Run the service-account checker over all pending approvals |
| `npm run approvals:approve -- <approvalId>` | Manually approve a single approval (as the SA) |
| `npm run approvals:reject -- <approvalId>` | Manually reject a single approval (as the SA) |

## Adapting to other contracts

`SCApproveOrReject.ts` reads the StableCoin ABI to decode call data. To check a different contract:

1. Replace `contracts/StableCoin.sol` with your own.
2. Update the artifact path and ABI loading in `SCApproveOrReject.ts`.
3. Replace the `if (decoded.functionName === 'mint')` block with the function names and rules you care about.

The framing (fetch pending → filter by wallet → decode → apply rules → post decision) stays the same.

## License

MIT
