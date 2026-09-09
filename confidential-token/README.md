# Confidential ERC-7984 token — FHEVM + DFNS

Deploy, mint, transfer, and reveal a confidential fungible token (ERC-7984, OpenZeppelin
`confidential-contracts`) on Ethereum Sepolia, using DFNS-managed wallets to sign every
transaction and every Zama relayer EIP-712 authorization.

## What this demo shows

- **Confidential balances**: all balances live on-chain as encrypted `euint64` values
  (Zama FHEVM); nobody but the holder can read them by default.
- **Confidential transfers**: amounts are encrypted client-side by the Zama relayer SDK
  and verified by an FHEVM input proof; the on-chain tx carries only ciphertext.
- **Two reveal flows**:
  1. **Holder-only** — the holder asks the relayer to user-decrypt their balance,
     authorising it with an EIP-712 signature produced by their DFNS wallet.
  2. **Public** — the holder calls `requestDiscloseEncryptedAmount` on-chain to flag
     a ciphertext as publicly decryptable, then any client can fetch the cleartext
     from the relayer.

## Layout

```
confidential-token/
├── contracts/
│   └── ConfidentialToken.sol    # ERC-7984 + Ownable + ZamaEthereumConfig
└── dfns/
    ├── DfnsCommon.ts            # DFNS client, viem Sepolia client, broadcast,
    │                            # FHEVM instance, DFNS-backed signTypedData
    ├── Deploy.ts                # Deploy from BANK_WALLET_ID
    ├── Mint.ts                  # Bank mints encrypted amount to SENDER
    ├── Transfer.ts              # SENDER confidentially transfers to RECEIVER
    ├── RevealBalance.ts         # Holder user-decrypts their own balance
    └── RevealPublic.ts          # Holder makes balance publicly decryptable
```

## Setup

```bash
cd confidential-token
npm install
cp .env.example .env
# Fill in DFNS_*, BANK_WALLET_ID, SENDER_WALLET_ID, RECEIVER_WALLET_ID
npm run compile
```

All three DFNS wallets must be EVM wallets on Sepolia and funded with a small amount
of test ETH (the bank wallet does more txs than the others).

## End-to-end demo

```bash
npm run deploy           # → writes deployment.json with the token address
npm run mint             # bank mints 1000 cUSD (encrypted) to SENDER
npm run transfer         # SENDER confidentially transfers 200 cUSD to RECEIVER

# Holder-only reveal (default holder: receiver). Pass `sender` to reveal the sender.
npm run reveal-balance
npm run reveal-balance -- sender

# Public reveal (default holder: receiver). Pass `sender` to disclose the sender.
npm run reveal-public
npm run reveal-public -- sender
```

## What is FHE (and why does this demo need it)?

**Fully Homomorphic Encryption (FHE)** is encryption that lets you compute directly on
ciphertexts. Given `Enc(a)` and `Enc(b)`, anyone holding only the ciphertexts can
produce `Enc(a + b)` or `Enc(a * b)` — without ever seeing `a`, `b`, or the result in
the clear. Only a party with the secret key can decrypt the final ciphertext.

For a token this means: balances stay encrypted on-chain (`euint64`), the EVM
coprocessor can run `sub(balanceFrom, amount)` and `add(balanceTo, amount)` on those
ciphertexts, and the chain never learns who owns how much. Validators verify *that*
the transfer happened, not *what* it was.

### The maths, briefly

Modern FHE schemes (BFV, BGV, CKKS, TFHE — the family Zama uses) are built on
**Learning With Errors (LWE)** and its ring variant **RLWE**. The intuition:

1. **A hard problem.** Start with a secret high-dimensional vector. Given many
   random linear combinations of that vector perturbed by small noise, recovering
   the secret is computationally hard — even for quantum computers. That's LWE.

2. **Encrypting a bit/integer.** The message is lifted into the high-order bits of
   a noisy linear combination of the secret. Decryption strips the noise by rounding,
   recovering the message. Security rests on the noise hiding the underlying
   structure.

3. **Homomorphic addition.** Add two ciphertexts component-wise. Noise accumulates
   additively — cheap.

4. **Homomorphic multiplication.** Multiplying two ciphertexts produces a quadratic
   expression in the secret. A **relinearization key** rewrites it back to standard
   linear form. Noise grows multiplicatively — expensive.

5. **Bootstrapping.** After enough operations the accumulated noise threatens to
   corrupt decryption. *Bootstrapping* homomorphically evaluates the decryption
   circuit on the ciphertext itself, producing a fresh ciphertext of the same
   plaintext with low noise. This is what makes the scheme *fully* homomorphic
   (unbounded depth). Zama's **TFHE** variant bootstraps after every gate, keeping
   arbitrary-depth circuits practical.

6. **Public-key + threshold decryption.** Encryption is public (anyone can encrypt
   under the network's public key), but the secret is **threshold-shared** across
   a KMS committee. No single party can decrypt; a quorum must cooperate, and only
   when the on-chain ACL approves the requester.

### How FHEVM wires this into Ethereum

The contract never holds raw ciphertexts — it holds **handles** (32-byte ids) that
point to ciphertexts stored off-chain by the **coprocessor**:

```
 user ──Enc(amount)──▶ relayer ──input proof──▶ contract.transfer(handle, proof)
                                                     │
                                                     ▼
                                            FHEVM precompile
                                            (sub, add on handles)
                                                     │
                                                     ▼
                                            new balance handles
                                                     │
                              ACL check ◀────────────┤
                                                     ▼
                       KMS threshold-decrypts ──▶ user / public reveal
```

- **Input proof**: a zero-knowledge proof, bound to `(contract, caller)`, that the
  ciphertext is well-formed and the encryptor knows the plaintext. Stops a malicious
  user from injecting a garbage ciphertext that decrypts to nonsense.
- **ACL (Access Control List)**: on-chain mapping from handle → who can decrypt.
  `FHE.allow(handle, addr)` grants user-decrypt rights; `FHE.makePubliclyDecryptable`
  grants everyone the right. The KMS refuses to decrypt unless the ACL agrees.
- **Coprocessor**: runs the actual homomorphic ops off-chain and posts results back;
  the EVM only sees handles and small proofs, keeping gas costs sane.
- **Relayer**: a convenience service that batches encryption, proof generation, and
  KMS decryption requests for clients.

That's the machinery underneath `euint64`, `FHE.add`, `confidentialTransfer`, and the
two reveal flows in the scripts below.

## How the encryption + reveal pieces fit together

### Encrypted input (Mint, Transfer)

```ts
const fhevm = await createInstance({ ...SepoliaConfig, network: rpcUrl })
const buf = fhevm.createEncryptedInput(tokenAddress, callerAddress)
buf.add64(amount)
const { handles, inputProof } = await buf.encrypt()
```

The `(tokenAddress, callerAddress)` binding is what the FHEVM input verifier checks:
the resulting `externalEuint64` handle can only be consumed by `tokenAddress` when
the caller is `callerAddress`. So:

- **Mint** binds to `(token, BANK)` — the bank is the caller of `mint(...)`.
- **Transfer** binds to `(token, SENDER)` — the sender is the caller of
  `confidentialTransfer(...)`.

### Holder-only reveal (RevealBalance.ts)

1. Read the encrypted balance handle from the contract with `confidentialBalanceOf`.
2. `fhevm.generateKeypair()` — produces an NaCl keypair the relayer will re-encrypt to.
3. `fhevm.createEIP712(pubKey, [token], startTs, durationDays)` — typed data the
   holder must sign to authorize the relayer to user-decrypt.
4. `dfnsSignTypedData(holderWalletId, { domain, types, message })` — DFNS signs.
5. `fhevm.userDecrypt(...)` — relayer returns the cleartext mapped by handle.

The DFNS-signed EIP-712 is the standard “user decryption request” from
[Zama's user-decryption guide](https://docs.zama.org/protocol/solidity-guides/v0.10/docs/sdk-guides/user-decryption.html);
we just route the signature through DFNS instead of a local `ethers.Signer`.

### Public reveal (RevealPublic.ts)

1. Read the holder's balance handle (same as above).
2. Call `requestDiscloseEncryptedAmount(handle)` on-chain from the holder's wallet.
   `ERC7984` forwards this to `FHE.makePubliclyDecryptable(handle)`, granting the
   public-decryption role to that ciphertext.
3. Call `fhevm.publicDecrypt([handle])` — the relayer returns the cleartext for
   any client.

The script retries `publicDecrypt` a few times because the gateway/KMS takes a moment
to pick up the new ACL state once the on-chain tx is mined.

## Notes

- **Solidity 0.8.27, EVM target `cancun`** — required by `@fhevm/solidity` 0.11.
- `ConfidentialToken` inherits `ZamaEthereumConfig` so the FHE coprocessor / ACL /
  KMS / input verifier addresses for Sepolia are pinned at construction time.
- ERC-7984 uses **6 decimals** (like USDC), so `1000` cUSD is `1_000_000_000` raw.
- `deployment.json` is the single source of truth for the deployed token address;
  it is gitignored.
- The bank wallet is the only minter (`Ownable`); update Deploy or transfer ownership
  if you want a different role split.

## References

- OpenZeppelin Confidential Contracts — <https://docs.openzeppelin.com/confidential-contracts/token>
- Zama Relayer SDK guides — <https://docs.zama.org/protocol/solidity-guides/v0.10/docs/sdk-guides>
- DFNS SDK — <https://www.npmjs.com/package/@dfns/sdk>

## Tests performed

End-to-end run on Sepolia using three DFNS-managed wallets (bank, sender, receiver).

### 1. Contract deployment

- **Deploy tx:** [0xa0b18d1a…0bc64f](https://sepolia.etherscan.io/tx/0xa0b18d1ac0f27e2610bf727924092ca8947d083a3ffb87c8441162e0710bc64f)
- **Token address:** [`0x313B2a82E6Ce9C1F0cF145F6C9dF84f7b3026CC6`](https://sepolia.etherscan.io/address/0x313b2a82e6ce9c1f0cf145f6c9df84f7b3026cc6)

### 2. Mint (bank → sender)

Bank minted 1000 cUSD (encrypted) to the sender wallet.

- **Mint tx:** [0x0fbc58d6…489964](https://sepolia.etherscan.io/tx/0x0fbc58d6fb88e200976d637d3930afc37f584948c2f16729bf8b71b2f9489964)

### 3. Holder-only reveal — sender balance after mint

```
Token:                    0x313B2a82E6Ce9C1F0cF145F6C9dF84f7b3026CC6
Holder (sender):          0xcBbF20347ade3A91Ac38c6C04F2BcD2BD464F30f
Encrypted balance handle: 0x83f93d18d1a58faee7f03205354073f4db017512aeff0000000000aa36a70500
DFNS EIP-712 signature:   0xf01a5e2401…
Decrypted balance (raw):  1000000000
Decrypted balance (cUSD): 1000
```

### 4. Confidential transfer (sender → receiver, 200 cUSD)

- **Transfer tx:** [0x096b1404…eb6500](https://sepolia.etherscan.io/tx/0x096b14040d2155fb04fe684ea2dcbe393030d9f705e85871e071962e64eb6500)

### 5. Holder-only reveal — sender balance after transfer

```
Token:                    0x313B2a82E6Ce9C1F0cF145F6C9dF84f7b3026CC6
Holder (sender):          0xcBbF20347ade3A91Ac38c6C04F2BcD2BD464F30f
Encrypted balance handle: 0x1c620c83863d62932be99f8513f16ff22664569d2bff0000000000aa36a70500
DFNS EIP-712 signature:   0x6f95c13863…
Decrypted balance (raw):  800000000
Decrypted balance (cUSD): 800
```

### 6. Holder-only reveal — receiver balance after transfer

```
Token:                    0x313B2a82E6Ce9C1F0cF145F6C9dF84f7b3026CC6
Holder (receiver):        0x084c0c0c13E05229C868AF23F67F799642F6E973
Encrypted balance handle: 0xf913a3f8dc5588674e31e67a8631a532f42fdf4e44ff0000000000aa36a70500
DFNS EIP-712 signature:   0xfa11483a45…
Decrypted balance (raw):  200000000
Decrypted balance (cUSD): 200
```

**Result:** 1000 cUSD minted → 800 cUSD remaining on sender + 200 cUSD on receiver. Balances reconcile, all transactions signed by DFNS wallets, all reveals authorised by DFNS-signed EIP-712 user-decryption requests.
