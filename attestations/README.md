# Attestations

On-chain proof binding a tokenized bond's smart contract address to its real-world identifiers, using the [Ethereum Attestation Service](https://attest.org) (EAS) on **Ethereum Sepolia**, signed through [Dfns](https://www.dfns.co/).

## Context

Static data accuracy, validity, and sourcing are critical in traditional finance. As more assets move on-chain, there's a growing need to attest and verify that kind of static data alongside the asset itself.

This solution demonstrates a third party -- e.g. a registrar or transfer agent -- attesting that a given bond smart contract has a specific **ISIN** and was issued by a legal entity identified by its **LEI**. The resulting attestation is a permanent, publicly verifiable on-chain record that anyone can check via the smart contract, the EAS block explorer, or the `verify` script in this repo.

## How it works

EAS is a public, generic attestation protocol: anyone can define a schema and anyone can issue an attestation against it. Here, the schema is a straightforward tuple:

```
address contractAddress, string isin, string lei
```

| Contract | Sepolia address | Role |
|---|---|---|
| `SchemaRegistry` | [`0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0`](https://sepolia.etherscan.io/address/0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0) | Registers the schema above, once |
| `EAS` | [`0xC2679fBD37d54388Ce493F1DB75320D236e1815e`](https://sepolia.etherscan.io/address/0xC2679fBD37d54388Ce493F1DB75320D236e1815e) | Stores each attestation issued against that schema |

Both are plain contract calls -- no attestation-specific SDK is required. Each script ABI-encodes the calldata with `viem` and broadcasts it through a Dfns wallet, the same pattern used in [`../bond-issuance`](../bond-issuance). The private key backing the attesting wallet never leaves Dfns's infrastructure; every transaction is signed via the Dfns API.

```
Attester (Dfns Wallet)          SchemaRegistry              EAS
       |                              |                      |
       |-- register(schema) -------->|                       |
       |                              |  schema UID           |
       |                              |                       |
       |-- attest(schema UID, --------------------------->  |
       |     address, isin, lei)      |                      |  attestation UID
       |                              |                       |
   anyone -- getAttestation(uid) ------------------------->  |  decode & verify
```

## Tech stack

- **Signing**: Dfns KMS via `@dfns/sdk`
- **Chain interaction**: `viem` (calldata encoding, event decoding, RPC reads)
- **Attestation protocol**: [EAS](https://attest.org) -- `SchemaRegistry` + `EAS` contracts on Sepolia
- **Scripts**: TypeScript (`tsx`), interactive CLI prompts
- **Network**: Ethereum Sepolia

## Quick start

### 1. Prerequisites

- Node.js v22+
- A [Dfns](https://www.dfns.co/) account with API credentials
- A Dfns wallet on Ethereum Sepolia, funded with a small amount of Sepolia ETH for gas (the "issuer" wallet from `bond-issuance` works fine)

### 2. Install

```bash
cd attestations
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
| `DFNS_CRED_ID` | Credential ID for the signing key |
| `DFNS_PRIVATE_KEY` | Private key (PEM) for signing API requests |
| `ISSUER_WALLET_ID` | Dfns wallet ID that signs the schema registration and attestations |
| `SEPOLIA_RPC_URL` | (Optional) Sepolia RPC endpoint |
| `SCHEMA_UID` | Filled in after step 4 |

### 4. Register the schema (one-time)

```bash
npm run register:schema
```

Copy the printed `Schema UID` into `SCHEMA_UID` in `.env`. The schema only needs to be registered once per network -- if it's already been registered (see [Example run](#example-run) below), reuse the existing UID instead of registering a duplicate.

### 5. Attest a bond

```bash
npm run attest
```

Enter the bond contract address, ISIN, and LEI. The script broadcasts the attestation through the Dfns wallet and prints the attestation UID plus a link to view it on the EAS Sepolia explorer.

### 6. Verify an attestation

```bash
npm run verify
```

Enter an attestation UID to read it directly from the `EAS` contract and decode the address/ISIN/LEI it proves -- no trust in an intermediary API required.

## Example run

**Schema registration**

- Tx: [`0xf11d5942281242b5fbb8a44fefa3795d1c63614ed184fa7632b10096364d5a7c`](https://sepolia.etherscan.io/tx/0xf11d5942281242b5fbb8a44fefa3795d1c63614ed184fa7632b10096364d5a7c)
- Schema UID: [`0xba0f316ad9362dc07c089b99109afa69d427461e2a13196aff236d399db4d281`](https://sepolia.easscan.org/schema/view/0xba0f316ad9362dc07c089b99109afa69d427461e2a13196aff236d399db4d281)

**Attestation**

```
$ npm run attest

--- Attest Bond Address <-> ISIN <-> LEI ---
Attesting from: 0xcbbf20347ade3a91ac38c6c04f2bcd2bd464f30f
Bond Contract Address: 0x8efD92A5491f5863087dBBeAC0D9B4c6351CeCfd
ISIN: ISIN123456789
LEI: R0MUWSFPU8MPRO8K5P83

Attestation UID: 0x468e3c63f5a3903f85494b2732d027698bf16f0fc291f32a7e9a9a2fa7f7cb7c
View at: https://sepolia.easscan.org/attestation/view/0x468e3c63f5a3903f85494b2732d027698bf16f0fc291f32a7e9a9a2fa7f7cb7c
```

**Verification**

```
$ npm run verify

--- Verify Attestation ---
Attestation UID: 0x468e3c63f5a3903f85494b2732d027698bf16f0fc291f32a7e9a9a2fa7f7cb7c

Attester: 0xcBbF20347ade3A91Ac38c6C04F2BcD2BD464F30f
Recipient: 0x8efD92A5491f5863087dBBeAC0D9B4c6351CeCfd
Revoked: false
Attested at: 7/22/2026, 6:23:00 PM

Bond Contract Address: 0x8efD92A5491f5863087dBBeAC0D9B4c6351CeCfd
ISIN: ISIN123456789
LEI: R0MUWSFPU8MPRO8K5P83
```

## Files

| File | Description |
|---|---|
| `scripts/dfns.ts` | Dfns API client + Sepolia `viem` public client setup |
| `scripts/eas.ts` | `EAS`/`SchemaRegistry` Sepolia addresses, ABI fragments, and the bond schema definition |
| `scripts/register-schema.ts` | Registers the `address,string,string` schema (one-time) |
| `scripts/attest.ts` | Creates an attestation for a bond address/ISIN/LEI |
| `scripts/verify-attestation.ts` | Reads and decodes an attestation by UID directly from the `EAS` contract |

## Notes

- Attestations here are marked `revocable: true`, so an attester can revoke a record later (e.g. if a bond is delisted or its static data changes). Revocation status is checked by the `verify` script.
- The `recipient` of each attestation is set to the bond contract address itself, so attestations can be looked up on-chain or via the EAS explorer by that address.
- No custom EAS SDK dependency is required at runtime -- the ABI fragments in `scripts/eas.ts` are taken verbatim from `@ethereum-attestation-service/eas-contracts`'s Sepolia deployment artifacts, keeping this in line with the plain `viem` + Dfns broadcast pattern used across this repo.

## License

MIT
