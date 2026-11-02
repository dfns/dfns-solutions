# Institutional Custody

> **Status: in progress.** Steps 1 to 6 are in place: setup script, first deposit, automatic checker, backend, Validation Gate handler with its signer simulator, and the walkthrough page. See [Run it](#run-it).

An institution holds client assets in Dfns Vaults and runs the controls its risk and compliance teams expect: every deposit is quarantined until screening clears it, every withdrawal needs an approval that the requester can't give (in the demo, one approver: a person or an automatic checker; typically 2 of 3 people in production), the institution's own **Validation Gate** gets a last veto before any key signs, and every balance movement can be exported for audit.

**Business use case:** custodians, banks and asset managers that need segregated client balances, maker-checker withdrawals and an independent signing veto, with a ledger auditors can read.

## Why this blueprint

| Existing blueprint | What it shows | What this one adds |
|---|---|---|
| [Bank Custody](../bank-custody/) | Retail wallets next to fiat accounts, one approver over a threshold | Institutional vaults, maker-checker approvals, deposit quarantine and screening, audit export |
| [Collateral](../collateral/) | Vaults, locks and quarantine release between a borrower and a lender | The full custody lifecycle around a single institution |
| [Programmable Policy](../programmable-policy/) | A service account approving decoded transactions | A Validation Gate: the institution's last veto, enforced by the signer itself |

No blueprint demonstrates the Validation Gate yet.

## The flow

### Deposit: quarantine, screening, release

```
External sender        Dfns Vault                     Screening              Custody ops
     |                      |                              |                       |
     |-- on-chain deposit ->|                              |                       |
     |                      | balance: Incoming            |                       |
     |                      | balance: Quarantined         |                       |
     |                      |-- release-quarantine policy ->|                      |
     |                      |                              | risk score            |
     |                      |<----------- low risk --------|                       |
     |                      | balance: Available           |                       |
     |                      |<----------- high risk -------|                       |
     |                      | stays Quarantined -------------------- review ------>|
     |                      |<------------------------------------- release / keep |
```

### Withdrawal: approval, Validation Gate, broadcast

```
Initiator           Dfns API / Policies        Approvers (3)       Signer              Validation Gate        Chain
    |                      |                        |                 |                 (institution)          |
    |-- vault transfer --->|                        |                 |                      |                |
    |                      | amount Locked          |                 |                      |                |
    |                      | policy: 1 approval --->|                 |                      |                |
    |                      |<------ approve --------|                 |                      |                |
    |                      |-- sign request ----------------------->  |                      |                |
    |                      |                        |                 |-- POST signerInfo -->|                |
    |                      |                        |                 |<----- 200 / reject --|                |
    |                      |<---------------------------- signature --|                      |                |
    |                      |-- broadcast ------------------------------------------------------------------->|
    |<-- Confirmed --------|                        |                 |                      |                |
```

### Audit export

Every balance change is an entry in the vault's append-only ledger. The app reads it through List Vault History, also receives the `Vault event created` webhook, and exports a CSV per vault and period.

## Dfns features per step

| Step | Dfns API or feature |
|---|---|
| Set up | Create Vault, Create Vault Address (one network per call), tags for policy scoping |
| Deposit lands | Vault balances: Incoming → Quarantined; List Vault Quarantines |
| Screening | Release-quarantine policy scoped by vault tag, with a KYT provider (Chainalysis, Elliptic or Global Ledger) |
| Manual review | Get Vault Quarantine, Release Quarantine |
| Withdrawal | Create Vault Transfer (reserves amount and fee from Available) |
| Withdrawal approval (one approver in the demo: a person or the checker) | Signing policy with an approval quorum; approvers decide with passkeys |
| Last veto | Validation Gate: the signer POSTs `signerInfo` (`kind`, `keyId`, `publicKey`, `txHash`) plus the intent (`path`, `payload { kind, to, amount }`) and source and destination addresses to the institution's endpoint, HMAC-signed; any non-200 rejects |
| Audit | List Vault History, `Vault event created` webhook |

## What runs where in the demo

| Piece | Demo | Production |
|---|---|---|
| Vaults, policies, approvals | Dfns API (testnet) | Same |
| Screening | KYT provider on testnet, or a stub that scores known addresses | KYT provider |
| Validation Gate handler | Included here: an HTTP service that verifies the HMAC and applies rules. Same request format and headers as a real signer, so it works unchanged behind one | Hosted by the institution |
| Signer call to the gate | A simulator script sends the signer's request (`signerInfo`, HMAC-signed) so the recipe runs with a plain SaaS org | The signer itself |
| Validation Gate enforcement | Documented for self-hosted signers, configured with `--validation-gate-url` on the signer. Whether a hosted SaaS org can use it isn't documented: to confirm. | The institution's signer |

## Open questions

1. Is there an environment (a SaaS org configured by Dfns, or an on-prem/dev one) where the gate can be enabled for real? Not blocking: the recipe uses the simulator; a real run would only be recorded for sales demos.
2. Which screening provider works on testnet vault deposits, and how is it wired to the release-quarantine policy? Per the docs, only Chainalysis is wired to quarantine release (`ChainalysisQuarantineScreening`), and it screens mainnets only, so the setup script falls back to one manual approval on Sepolia.
3. ~~The gate only receives `txHash`, not the decoded transaction.~~ Answered: per `validation-gate-core`, the signer also sends the intent (`path` and `payload { kind, to, amount }`), the initiator (`userId`, `username`) and the source and destination addresses, so the handler applies its rules without calling the Dfns API. Requests without an intent (raw signatures) are rejected by default.
4. Approvals: which two org users act as approvers? Each needs `Policies:Evaluations:Vote`; nobody can approve their own request, and service accounts can't approve, so it takes real people.
5. Network: EVM testnet (Sepolia or Hoodi) to start; Bitcoin and Solana later?

## Plan

1. Setup script: vault, address, tags, policies (release-quarantine with manual review on testnet, 1-of-2 withdrawal approval). *Done.*
2. First deposit: send Sepolia ETH from an ordinary Dfns wallet to the vault address. It lands as Quarantined and exercises the release policy end to end. *Done: released after a second person's approval; a test withdrawal triggered the withdrawal policy.*
3. Automatic checker: a dedicated service account (role limited to `Policies:Evaluations:Read` and `Vote`) is one of the withdrawal approvers and votes by rule (amount cap, destination allowlist), like [Programmable Policy](../programmable-policy/). People stay in the approval group as the fallback above the cap. The checker must differ from the service account that requests withdrawals. *Done: `npm run checker`. It approves or leaves for a human, never rejects.*
4. Backend (TypeScript, like [Collateral](../collateral/)): deposits and quarantines, withdrawals, approvals, audit export. It follows each operation's status: `Pending` (awaiting approvals) → `Executing` → `Broadcasted` → `Confirmed`, plus `Failed` / `Rejected`, and quarantined → release requested → released for deposits. *Done: `npm start`. It polls the Dfns API every 10 s rather than taking webhooks, since the demo machine isn't reachable from the internet. All polling sits in `src/poller.ts`, so webhooks (`vault.event.created`, `wallet.transfer.*`, `policy.approval.*`) can replace it later.*
5. Validation Gate handler with HMAC verification and simple rules (amount cap, allowlist, business hours), plus a signer simulator. Take the request format, headers and responses from Dfns's own gate code (`validation-gate-core` and `validation-gate-test-utils` in `dfnsco/coresign`), so the handler plugs into a real signer unchanged. If an environment allows it, record one real end-to-end run. *Done: `npm run gate` and `npm run simulate`. A real signer run is still open (question 1).*
6. Web UI: a live walkthrough in seven stages (vault and controls, deposit and quarantine, safekeeping, withdrawal and approval, Validation Gate, broadcast and confirmation, audit trail), each with live data, the actions it allows and the raw data behind it. *Done: `npm start`, then http://localhost:3000.*
7. Tutorial page on docs.dfns.co.

## Run it

```bash
npm install
cp .env.example .env    # then fill it in
npm run setup           # vault, address, policies, checker as approver
npm run checker         # leave running: votes on pending withdrawals
```

The checker votes **approve** when a withdrawal is native ETH, its destination is in `CHECKER_ALLOWLIST` and its amount is at most `CHECKER_MAX_AMOUNT_WEI`. Otherwise it does nothing and logs why, so a person decides. It runs with its own service account (`CHECKER_*`), whose role only reads and votes on approvals.

For a service account to vote, the approval group needs `serviceAccountsCanApprove: true`, which Dfns activates per organization. `npm run setup` sets it when it adds the checker; if the vote is refused, the checker logs it and leaves the withdrawal for a human.

### Walkthrough page

```bash
npm start               # then open http://localhost:3000
```

One page, served by the backend, with no build step and no external resources. It walks through seven stages, all on live data. Each stage has a short explanation, a live panel and a "What happened in DFNS" section with the raw data behind it. You can release a deposit (stage 2) and request a withdrawal (stage 4) from the page. It polls the backend every 3 seconds and shows a banner when DFNS data can't be refreshed or the backend stops. The Validation Gate stage shows "gate not running" until `npm run gate` is up. Arrow keys move between stages, and `#stage-N` links straight to one.

### Running the demo

Before the call: fund the vault with a little Sepolia ETH, set `CHECKER_ALLOWLIST` and `GATE_ALLOWLIST` to the address you'll withdraw to, and keep the DFNS dashboard open on a second tab, logged in as a second approver.

Open three terminals in `institutional-custody/`:

1. `npm start`: the backend and the page.
2. `npm run gate`: the institution's Validation Gate.
3. `npm run checker`: the automatic approver.

Then share the browser on http://localhost:3000 and go through the stages:

| Stage | Do | Say |
|---|---|---|
| The rule (top) | Point at it | A key signs only after policy, approval and the institution's own gate have all said yes, and every step leaves a record. The rest of the page proves it, live. |
| 1. Vault and controls | Show the vault, its tag and the two policies | The controls exist before any money arrives. Policies follow the tag, so a new vault with the same tag gets the same rules. The requester can never approve their own operation. |
| 2. Deposit and quarantine | Send a small deposit from any Sepolia wallet before the call, or live. Click **Release**, give a reason, then approve it in the dashboard as the second person | Incoming funds are never spendable on arrival. Releasing them is an operation under policy too, with a reason kept for audit. |
| 3. Safekeeping | Watch Quarantined turn into Available | The vault is a ledger: every amount is in exactly one state. |
| 4. Withdrawal and approval | Request 0.001 ETH to the allowlisted address. Watch the checker approve it. Then request one above the cap: it waits for a person | Small, known transfers flow; anything else needs a human. The checker can only read and vote, and it's a different identity from the one that requests. |
| 5. Validation Gate | In a fourth terminal, run `npm run simulate`. Six decisions appear | This is the institution's last veto, on its own side. A self-hosted signer calls it before every signature; here the simulator sends the exact same requests. |
| 6. Broadcast and confirmation | Open the confirmed withdrawal's transaction on Etherscan | Every withdrawal carries its own timeline, from request to on-chain confirmation. |
| 7. Audit trail | Click **Download CSV** | The ledger comes from DFNS itself, ready for an auditor: who asked, what moved, where, and the transaction hash. |

### Backend

```bash
npm start               # http://localhost:3000, polls Dfns every 10 s
```

The terminal prints one line per status change as it polls: a deposit landing as quarantined, a release requested and released, a withdrawal going from pending approval to broadcast and confirmed, approvals requested and decided. The backend uses the backend service account (`DFNS_*`); to see pending approvals it needs `Policies:Evaluations:Read`. If one source fails (a missing permission, say), the others still update and `/api/state` says which failed under `errors`.

```bash
# Vault balances by asset and kind, pending quarantines, recent withdrawals, pending approvals
curl -s localhost:3000/api/state

# The status changes seen since startup
curl -s localhost:3000/api/timeline

# Withdraw 0.001 ETH: answers at once with status Pending and an approval id
curl -s -X POST localhost:3000/api/withdrawals -H 'Content-Type: application/json' \
  -d '{"amountEth": "0.001", "to": "0xYourAddress"}'

# Release a quarantined deposit (id from /api/state); a person then approves it
curl -s -X POST localhost:3000/api/quarantines/vlt-qua-.../release -H 'Content-Type: application/json' \
  -d '{"reason": "Sender known, deposit expected"}'

# The vault's full history as CSV: date, kind, amount, asset, counterparty, tx hash, status, requester
curl -s -OJ localhost:3000/api/audit.csv
```

SDK 0.8.31 doesn't wrap List Vault History yet, so `src/dfns.ts` calls `GET /vaults/{vaultId}/history` through the SDK's own transport; from SDK 0.8.33 it's `vaults.listVaultHistory`.

### Validation Gate

```bash
openssl rand -hex 32    # put it in .env as GATE_SHARED_SECRET
npm run gate            # the handler, on http://localhost:4000/validate
npm run simulate        # in another terminal: six signer requests
npm test                # HMAC and rules
```

The handler checks the `x-payload-signature` header (base64 HMAC-SHA256 of the raw body with the shared secret) before reading anything, then applies the rules: signing only (no key export), native ETH, amount at most `GATE_MAX_AMOUNT_WEI`, destination in `GATE_ALLOWLIST`, optionally within `GATE_HOURS`. Requests without an intent are rejected. It logs one line per decision and answers:

| Status | Meaning | What the signer does |
|---|---|---|
| `200` | Approved | Signs |
| `401` | Missing or bad signature | Refuses (`Unauthenticated`) |
| `400` | Malformed request | Refuses (`Unauthenticated`) |
| `403` | A rule rejected it; the JSON body says which | Refuses (`PermissionDenied`) |

The simulator sends an allowed transfer, one over the cap, one to an address off the allowlist, one with a bad signature, a key export and a request without an intent, and checks each answer. With GATE_HOURS set and the current time outside them, it expects the allowed transfer to be rejected too.

The request format, headers and status handling come from Dfns's signer code (`validation-gate-core` in `dfnsco/coresign`), not the public docs, which are out of date. Behind a real signer, set `--validation-gate-url` to the handler's URL and give both sides the same secret.

## Possible extensions

- **Travel rule:** on a withdrawal to another regulated institution, show originator and beneficiary data being exchanged (e.g. Notabene) before the transfer goes out. Depends on how Dfns integrates it.
- **HSM keystore:** the same flow on an HSM-backed keystore instead of MPC, the setup on-prem banks run. Only the keystore behind the vault changes.
