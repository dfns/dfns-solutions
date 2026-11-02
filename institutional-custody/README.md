# Institutional Custody

> **Status: in progress.** Steps 1 to 3 are in place: setup script, first deposit and the automatic checker. See [Run it](#run-it).

An institution holds client assets in Dfns Vaults and runs the controls its risk and compliance teams expect: every deposit is quarantined until screening clears it, every withdrawal needs another person's approval (1 of 2 in the demo, typically 2 of 3 in production), the institution's own **Validation Gate** gets a last veto before any key signs, and every balance movement can be exported for audit.

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
    |                      | policy: 1 of 2 ------->|                 |                      |                |
    |                      |<---- approve (x2) -----|                 |                      |                |
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
| Withdrawal approval (1 of 2 in the demo) | Signing policy with an approval quorum; approvers decide with passkeys |
| Last veto | Validation Gate: the signer POSTs `signerInfo` (`kind`, `keyId`, `publicKey`, `txHash`) to the institution's endpoint, HMAC-signed; any non-200 rejects |
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
3. The gate only receives `txHash`, not the decoded transaction. Should the handler look up the pending transfer (by hash) through the Dfns API to apply business rules?
4. Approvals: which two org users act as approvers? Each needs `Policies:Evaluations:Vote`; nobody can approve their own request, and service accounts can't approve, so it takes real people.
5. Network: EVM testnet (Sepolia or Hoodi) to start; Bitcoin and Solana later?

## Plan

1. Setup script: vault, address, tags, policies (release-quarantine with manual review on testnet, 1-of-2 withdrawal approval). *Done.*
2. First deposit: send Sepolia ETH from an ordinary Dfns wallet to the vault address. It lands as Quarantined and exercises the release policy end to end. *Done: released after a second person's approval; a test withdrawal triggered the withdrawal policy.*
3. Automatic checker: a dedicated service account (role limited to `Policies:Evaluations:Read` and `Vote`) is one of the withdrawal approvers and votes by rule (amount cap, destination allowlist), like [Programmable Policy](../programmable-policy/). People stay in the approval group as the fallback above the cap. The checker must differ from the service account that requests withdrawals. *Done: `npm run checker`. It approves or leaves for a human, never rejects.*
4. Backend (TypeScript, like [Collateral](../collateral/)): deposits and quarantines, withdrawals, approvals, audit export. Track each operation's status from webhooks rather than polling: `Pending` (awaiting approvals) → `Executing` → `Broadcasted` → `Confirmed`, plus `Failed` / `Rejected`, and quarantine and release for deposits.
5. Validation Gate handler with HMAC verification and simple rules (amount cap, allowlist, business hours), plus a signer simulator. Take the request format, headers and responses from Dfns's own gate code (`validation-gate-core` and `validation-gate-test-utils` in `dfnsco/coresign`), so the handler plugs into a real signer unchanged. If an environment allows it, record one real end-to-end run.
6. Web UI: Operations, Approvers and Audit views, with a live status timeline per operation (from the webhooks above) and the raw Dfns calls behind it.
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

## Possible extensions

- **Travel rule:** on a withdrawal to another regulated institution, show originator and beneficiary data being exchanged (e.g. Notabene) before the transfer goes out. Depends on how Dfns integrates it.
- **HSM keystore:** the same flow on an HSM-backed keystore instead of MPC, the setup on-prem banks run. Only the keystore behind the vault changes.
