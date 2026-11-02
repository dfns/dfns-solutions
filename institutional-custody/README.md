# Institutional Custody

> **Status: in progress.** Step 1 (setup script) is in place: `npm install`, fill `.env` from `.env.example`, then `npm run setup`.

An institution holds client assets in Dfns Vaults and runs the controls its risk and compliance teams expect: every deposit is quarantined until screening clears it, every withdrawal needs two of three approvers, the institution's own **Validation Gate** gets a last veto before any key signs, and every balance movement can be exported for audit.

**Business use case:** custodians, banks and asset managers that need segregated client balances, maker-checker withdrawals and an independent signing veto, with a ledger auditors can read.

## Why this blueprint

| Existing blueprint | What it shows | What this one adds |
|---|---|---|
| [Bank Custody](../bank-custody/) | Retail wallets next to fiat accounts, one approver over a threshold | Institutional vaults, 2-of-3 approvals, deposit quarantine and screening, audit export |
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

### Withdrawal: 2-of-3 approval, Validation Gate, broadcast

```
Initiator           Dfns API / Policies        Approvers (3)       Signer              Validation Gate        Chain
    |                      |                        |                 |                 (institution)          |
    |-- vault transfer --->|                        |                 |                      |                |
    |                      | amount Locked          |                 |                      |                |
    |                      | policy: 2 of 3 ------->|                 |                      |                |
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
| 2-of-3 approval | Signing policy with an approval quorum; approvers decide with passkeys |
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
4. Approvals: three users with passkeys, or service accounts for the demo?
5. Network: EVM testnet (Sepolia or Hoodi) to start; Bitcoin and Solana later?

## Plan

1. Setup script: vault, address, tags, policies (release-quarantine with screening, 2-of-3 withdrawal approval).
2. Backend (TypeScript, like [Collateral](../collateral/)): deposits and quarantines, withdrawals, approvals, audit export.
3. Validation Gate handler with HMAC verification and simple rules (amount cap, allowlist, business hours), plus a signer simulator. Built standalone first, so it plugs into a real signer unchanged; if an environment allows it, record one real end-to-end run.
4. Web UI: Operations, Approvers and Audit views, with a live timeline of every Dfns call.
5. Tutorial page on docs.dfns.co.
