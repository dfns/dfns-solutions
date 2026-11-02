// Creates the Dfns resources the demo needs and writes their IDs to .env.
// Safe to re-run: anything already set in .env is reused, not recreated.
//
//   vault              → tagged custody vault + Sepolia address
//   withdrawal policy  → vault transfers need 2 of 3 approvers
//   quarantine policy  → deposits need a manual review before release
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { requireEnv, env } from '../src/env.js'
import { api, vaults } from '../src/dfns.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ENV_PATH = path.join(__dirname, '../.env')
const NETWORK = 'EthereumSepolia'
// Policies on quarantine release are scoped by this vault tag, so any vault
// the institution adds later with the same tag gets the same controls.
const TAG = 'custody-demo'
const APPROVERS = 3
const QUORUM = 2

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

async function ensureVault() {
    const vaultId = await ensure('VAULT_ID', 'Vault', async () => {
        const vault = await vaults.createVault({ body: { name: 'Institutional custody demo', tags: [TAG] } })
        return vault.id
    })
    const vault = await vaults.getVault({ vaultId })
    // A vault reused from .env may predate the tag
    if (!vault.tags.includes(TAG)) {
        await vaults.tagVault({ vaultId, body: { tags: [TAG] } })
        console.log(`  + tag: ${TAG}`)
    } else {
        console.log(`  ✓ tag: ${TAG}`)
    }
    let address = vault.addresses?.find(a => a.network === NETWORK)
    if (!address) {
        address = await vaults.createVaultAddress({ vaultId, body: { network: NETWORK } })
        console.log(`  + ${NETWORK} address: ${address.address}`)
    } else {
        console.log(`  ✓ ${NETWORK} address: ${address.address}`)
    }
    return { vaultId, address: address.address, walletId: address.walletId }
}

// Vault transfers are gated by Wallets:Sign policies, whose filters take wallet
// IDs or wallet tags but not vault tags. So this policy is scoped to the
// vault's managed wallet (the one behind its Sepolia address).
async function ensureWithdrawalPolicy(walletId: string) {
    const approvers = env('APPROVER_USER_IDS').split(',').map(s => s.trim()).filter(Boolean)
    if (!env('WITHDRAWAL_POLICY_ID') && approvers.length < APPROVERS) {
        console.log(`  ! Skipped: APPROVER_USER_IDS has ${approvers.length} of ${APPROVERS} user IDs.`)
        console.log(`    Add ${APPROVERS - approvers.length} more (us-..., comma-separated) and re-run.`)
        console.log('    Each needs the Policies:Evaluations:Vote permission, or Dfns rejects the policy.')
        return undefined
    }
    if (approvers.length > APPROVERS) {
        console.log(`  ! APPROVER_USER_IDS has ${approvers.length} IDs, using the first ${APPROVERS}`)
    }
    return ensure('WITHDRAWAL_POLICY_ID', `Withdrawal policy (${QUORUM} of ${APPROVERS})`, async () => {
        const policy = await api.policies.createPolicy({
            body: {
                name: `Custody demo: ${QUORUM} of ${APPROVERS} withdrawal approval`,
                activityKind: 'Wallets:Sign',
                rule: { kind: 'AlwaysTrigger' },
                action: {
                    kind: 'RequestApproval',
                    approvalGroups: [{
                        name: 'Custody approvers',
                        quorum: QUORUM,
                        approvers: { userId: { in: approvers.slice(0, APPROVERS) } },
                    }],
                },
                filters: { walletId: { in: [walletId] } },
            },
        })
        return policy.id
    })
}

// Chainalysis is the only provider wired to quarantine release
// (ChainalysisQuarantineScreening), and it screens mainnets only. On Sepolia
// the policy falls back to one manual approval by any org user. Service
// accounts can't approve by default, so a person has to review each deposit.
async function ensureQuarantinePolicy() {
    return ensure('QUARANTINE_POLICY_ID', 'Release-quarantine policy (manual review)', async () => {
        const policy = await api.policies.createPolicy({
            body: {
                name: 'Custody demo: manual review of deposits',
                activityKind: 'Vaults:ReleaseQuarantine',
                rule: { kind: 'AlwaysTrigger' },
                action: {
                    kind: 'RequestApproval',
                    approvalGroups: [{ name: 'Deposit reviewers', quorum: 1, approvers: {} }],
                },
                filters: { vaultTags: { hasAny: [TAG] } },
            },
        })
        return policy.id
    })
}

async function main() {
    console.log('\nVault')
    const vault = await ensureVault()
    console.log('\nPolicies')
    const withdrawal = await ensureWithdrawalPolicy(vault.walletId)
    const quarantine = await ensureQuarantinePolicy()

    console.log(`
IDs saved to .env.

  Vault              ${vault.vaultId} (tag ${TAG})
  Fund this address  ${vault.address}
    → Sepolia ETH from a faucet
  Withdrawals        ${withdrawal ?? 'no policy yet: set APPROVER_USER_IDS and re-run'}
    → ${QUORUM} of ${APPROVERS} approvers on every transfer from the vault
  Deposits           ${quarantine}
    → one manual approval before quarantined funds become Available.
      Screening isn't available on testnet: Chainalysis, the provider for
      quarantine release, only screens mainnets.

Next steps:
  1. Fund the address. The deposit lands as Quarantined.
  2. Release it (dashboard or releaseQuarantine), then approve the release
     as another org user.
`)
}

main().catch(e => {
    console.error(e)
    process.exit(1)
})
