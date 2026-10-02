// Creates the Dfns resources the demo needs and writes their IDs to .env.
// Safe to re-run: anything already set in .env is reused, not recreated.
//
//   borrower → vault + Sepolia address (collateral, borrowed PYUSD, gas)
//   lender   → vault + Sepolia address (loan book, lock beneficiary, gas)
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { requireEnv, env } from '../src/env.js'
import { borrowerVaults, lenderVaults } from '../src/dfns.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ENV_PATH = path.join(__dirname, '../.env')
const NETWORK = 'EthereumSepolia'

requireEnv('DFNS_ORG_ID', 'DFNS_AUTH_TOKEN', 'DFNS_CRED_ID', 'DFNS_PRIVATE_KEY')

// Sets KEY=value in .env, replacing an existing (empty) line or appending one
function saveEnv(key: string, value: string) {
    const text = fs.readFileSync(ENV_PATH, 'utf8')
    const line = `${key}=${value}`
    const re = new RegExp(`^${key}=.*$`, 'm')
    fs.writeFileSync(ENV_PATH, re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`)
    process.env[key] = value
}

async function ensure(key: string, label: string, create: () => Promise<string>) {
    if (env(key)) {
        console.log(`  ✓ ${label}: ${env(key)} (from .env)`)
        return env(key)
    }
    const id = await create()
    saveEnv(key, id)
    console.log(`  + ${label}: ${id}`)
    return id
}

async function ensureVault(key: string, label: string, vaults: typeof borrowerVaults) {
    const vaultId = await ensure(key, `${label} vault`, async () => {
        const vault = await vaults.createVault({ body: { name: `Collateral demo: ${label.toLowerCase()} vault` } })
        return vault.id
    })
    const vault = await vaults.getVault({ vaultId })
    let address = vault.addresses?.find(a => a.network === NETWORK)?.address
    if (!address) {
        address = (await vaults.createVaultAddress({ vaultId, body: { network: NETWORK } })).address
        console.log(`  + ${NETWORK} address: ${address}`)
    } else {
        console.log(`  ✓ ${NETWORK} address: ${address}`)
    }
    return address
}

async function main() {
    console.log('\nBorrower')
    const borrower = await ensureVault('BORROWER_VAULT_ID', 'Borrower', borrowerVaults)
    console.log('\nLender')
    const lender = await ensureVault('LENDER_VAULT_ID', 'Lender', lenderVaults)

    console.log(`
IDs saved to .env. Now fund the demo on Sepolia:

  Borrower vault  ${borrower}
    → Sepolia ETH (collateral, plus gas for repayments and lock transfers)
  Lender vault    ${lender}
    → PYUSD (the loan book) from the Paxos faucet
    → Sepolia ETH (gas for payouts)

Every deposit lands as Quarantined. Accept it in the UI (or with
releaseQuarantine) before it counts as Available.

Then run 'npm run fund:buffer' to give the borrower PYUSD for interest,
and 'npm start' to launch the UI.
`)
}

main().catch(e => {
    console.error(e)
    process.exit(1)
})
