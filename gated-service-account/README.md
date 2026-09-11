# Gate a service account with a policy

Reference implementation for the solution [Gate a service account with a policy](https://docs.dfns.co/solutions/gate-service-account-signing).

A service account signs its sensitive calls with User Action Signing. If its credential key is a DFNS MPC key, that signature is produced by `POST /keys/{keyId}/signatures`, which the policy engine evaluates. A `Wallets:Sign` policy on that key holds every signature for an approval quorum, so the account's bearer token can read but cannot mutate until humans approve.

## How it works

```
service account          admin identity              approval quorum
  |  init challenge          |                              |
  |------------------------> |                              |
  |  challenge               |                              |
  | <------------------------|                              |
  |                          |  POST /keys/{id}/signatures  |
  |                          |---------------------------->  policy triggers
  |                          |  Pending + approvalId        |
  |                          | <----------------------------|
  |                          |                              |  approve
  |                          |                              |----------->
  |                          |  MPC signs, status Signed    |
  |  complete /auth/action (assertion = MPC signature)      |
  |------------------------> |                              |
  |  userAction token        |                              |
  |  privileged call with X-DFNS-USERACTION                 |
  |------------------------> | done                         |
```

The key is scoped to the policy through a **proxy wallet**: policies filter on wallet tags, not key ids, and a key-based signature request matches a policy through the wallets built on that key.

Two identities appear by necessity, not by choice: requesting the MPC signature is itself a user action, and the service account's only credential *is* the gated key — it can never bootstrap its own signature request. Any non-gated identity with `Keys:Signatures:Create` can play that operator role; this demo uses the admin identity, a production app typically uses a dedicated operator service account.

## The integration is one class

The whole gate is packaged as a [`CredentialSigner`](https://github.com/dfns/dfns-sdk-ts) for the DFNS TypeScript SDK. `GatedKeySigner.sign()` runs the challenge through the quorum-held MPC key (signature request → policy hold → approval → signed assertion), so the gated client is a completely ordinary `DfnsApiClient`:

```ts
const sa = new DfnsApiClient({
  authToken: GATED_SA_TOKEN,
  signer: new GatedKeySigner({ keyId, operator: admin, autoApprove }),
})

await sa.wallets.createWallet({ body: { network: 'SolanaDevnet', name: 'created-under-quorum' } })
// ^ pauses at the policy, resumes when the quorum approves
```

Nothing downstream of the constructor knows the gate exists.

## What you need

- A DFNS **development** organization
- An admin identity that can create keys, wallets, policies, and permissions, and vote on approvals
- Node.js v22.18+ (runs TypeScript natively via type stripping)

## Setup

```bash
npm install
cp .env.example .env
# fill in DFNS_API_URL, DFNS_AUTH_TOKEN, DFNS_CRED_ID, DFNS_PRIVATE_KEY
```

## Run

The service-account creation step is interactive (the API does not accept a service-account or PAT token on `POST /auth/service-accounts`), so the flow has three phases.

```bash
npm run setup
```

Creates the MPC key, the tagged proxy wallet, the `Wallets:Sign` quorum policy, and a minimal permission, then prints the key's public key as SPKI PEM.

In the dashboard: **Settings → Service Accounts → New**, name it as printed, assign the printed permission, and paste the public key. Copy the access token shown once into `.env` as `GATED_SA_TOKEN`.

```bash
npm run go
```

Runs the gated round-trip: the service account initiates a challenge to create a wallet, the signature over that challenge is held by the policy, the quorum approves, the MPC signature is verified locally against the registered public key, and the service account completes the user action and creates the wallet.

```bash
npm run cleanup
```

Archives the policy and permission. Deactivate the service account from the dashboard.

## Configuration

The approval group is built from environment variables at `setup` time. See [`.env.example`](.env.example) for `QUORUM`, `APPROVER_USER_IDS`, `INITIATOR_CAN_APPROVE`, and `SERVICE_ACCOUNT_APPROVERS`. `AUTO_APPROVE` controls whether `go` casts the vote for you (demo) or waits for a dashboard approval.

## Notes

- **Only signing is gated.** Key lifecycle operations (create, import, export, delegate, delete) are governed by permissions, not policies. This gates *use* of the key.
- **Value-based rules cannot read a raw signature.** Use `AlwaysTrigger`; amount and recipient rules fail closed on an opaque challenge.
- **Challenge lifetime is bounded.** A challenge completed after a five-minute delay in testing, but do not assume hours. Keep the quorum responsive, and treat an expired challenge as a restart, which means a new signature and a new approval.
- **Service-account approvers must be explicit.** If an approver is itself a service account, list it in `APPROVER_USER_IDS` and set `SERVICE_ACCOUNT_APPROVERS=true`; an empty approver list admits only human users.

Use a development organization. The scripts print no secrets, and `.env`, `.env.gated`, and `state.json` are gitignored.
