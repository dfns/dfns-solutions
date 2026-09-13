## Local testing without Dfns

`POST /sessions` always verifies the client-submitted approve tx **for real, on-chain**, regardless of any of this — `LOCAL_MODE` only affects where the merchant/spender identity comes from and whether `/settle` actually broadcasts.

### Real settlement via a raw private key (no Dfns)

```bash
LOCAL_MODE=true
LOCAL_MERCHANT_ADDRESS=0x791D3A805cE1f164FB863818d0eFEb265907De6c
MERCHANT_PRIVATE_KEY=0x...   # the private key for that same address
```

With both set, `/settle` signs and broadcasts a **real** `transferFrom` using a plain `ethers.Wallet` instead of Dfns. This is genuinely on-chain — the customer's approve lands via their own wallet (e.g. MetaMask), and the merchant's settlement lands via this key. The merchant wallet needs Base Sepolia ETH for gas, and every settlement shows up on [Blockscout](https://base-sepolia.blockscout.com) / [BaseScan](https://sepolia.basescan.org) like any other transaction. Use a throwaway key that holds nothing but testnet funds — never a key with real value behind it.

### Simulated settlement (no private key)

```bash
LOCAL_MODE=true
LOCAL_MERCHANT_ADDRESS=0x791D3A805cE1f164FB863818d0eFEb265907De6c
```

Without `MERCHANT_PRIVATE_KEY`, `/settle` returns a fake tx hash instead of broadcasting. The session/pull flow can still be exercised end-to-end (budget debits, denials, receipts all work normally), but no funds move and the returned hash won't resolve on a block explorer. Useful for iterating on the UI/mechanics without needing gas.

Both of these are **temporary stand-ins** for testing the session mechanics (approve → verify → pull → debit → settle) without a Dfns account.

**TODO before this is a real demo again:** set `LOCAL_MODE=false`, remove `MERCHANT_PRIVATE_KEY`, and fill in `DFNS_API_URL`, `DFNS_ORG_ID`, `DFNS_CRED_ID`, `DFNS_PRIVATE_KEY`, `DFNS_AUTH_TOKEN`, and `DFNS_MERCHANT_WALLET_ID` (a real Base Sepolia Dfns wallet, funded with gas) so `/settle` broadcasts through Dfns again.
