// Creates the Dfns resources the demo needs and writes their IDs to .env.
// Safe to re-run: anything already set in .env is reused, not recreated.
//
//   vault              → tagged custody vault + Sepolia address
//   withdrawal policy  → vault transfers need one approval, never the requester's
//   checker            → added to the withdrawal approvers, votes by rule
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
// 1 of 2 keeps the demo runnable with two people; an institution would
// typically use 2 of 3 or more.
const APPROVERS = 2
const QUORUM = 1

// Named after the rule, not the head count, which changes when the checker
// joins: "one approver: a person or the checker"
function withdrawalPolicyName(withChecker: boolean) {
    const who = withChecker ? 'a person or the checker' : 'a person'
    return `Custody demo: withdrawal approval (${QUORUM === 1 ? 'one approver' : `${QUORUM} approvers`}: ${who})`
}

type Policy = Awaited<ReturnType<typeof api.policies.getPolicy>>
type PolicyBody = Parameters<typeof api.policies.updatePolicy>[0]['body']

// Update Policy replaces the whole policy, and a Policies:Modify policy on
// the org holds the update for approval instead of applying it. So send it,
// then read the policy back rather than trust the call.
async function updateAndConfirm(policyId: string, body: PolicyBody, applied: (p: Policy) => boolean, what: string) {
    await api.policies.updatePolicy({ policyId, body })
    if (applied(await api.policies.getPolicy({ policyId }))) return true
    console.log(`  ! ${what} sent but not applied yet: it may be pending approval`)
    console.log(`    under a Policies:Modify policy. Approve it in the dashboard, then re-run.`)
    return false
}

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
    return ensure('WITHDRAWAL_POLICY_ID', 'Withdrawal policy', async () => {
        const policy = await api.policies.createPolicy({
            body: {
                name: withdrawalPolicyName(false),
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

// Adds the checker service account to the withdrawal policy's approval group,
// keeping everything else on the policy as it is: the current one is read
// first and sent back with the checker added (and the name to match). Service
// accounts only vote when the group allows it
// (serviceAccountsCanApprove), which Dfns has to activate on the org.
async function ensureCheckerApprover(policyId: string | undefined) {
    const checkerId = env('CHECKER_USER_ID')
    if (!checkerId) {
        console.log('  ! Checker not added: set CHECKER_USER_ID and re-run.')
        return false
    }
    if (!policyId) return false
    const policy = await api.policies.getPolicy({ policyId })
    if (policy.activityKind !== 'Wallets:Sign' || policy.action.kind !== 'RequestApproval') {
        throw new Error(`Policy ${policyId} is not a Wallets:Sign approval policy`)
    }
    const [group, ...others] = policy.action.approvalGroups
    const users = 'userId' in group.approvers ? group.approvers.userId?.in ?? [] : []
    if (users.includes(checkerId) && group.serviceAccountsCanApprove) {
        console.log(`  ✓ Checker ${checkerId} in "${group.name ?? 'approvers'}"`)
        return true
    }
    if (!('userId' in group.approvers)) {
        // An empty approvers object means anyone in the org: nothing to add to
        throw new Error(`Policy ${policyId} lets anyone approve; name the approvers first`)
    }
    const applied = await updateAndConfirm(policyId, {
        name: withdrawalPolicyName(true),
        activityKind: policy.activityKind,
        rule: policy.rule,
        action: {
            ...policy.action,
            approvalGroups: [{
                ...group,
                approvers: { ...group.approvers, userId: { in: [...new Set([...users, checkerId])] } },
                serviceAccountsCanApprove: true,
            }, ...others],
        },
        filters: policy.filters,
    },
        p => p.activityKind === 'Wallets:Sign' && p.action.kind === 'RequestApproval'
            && 'userId' in p.action.approvalGroups[0].approvers
            && !!p.action.approvalGroups[0].approvers.userId?.in.includes(checkerId),
        'Checker update')
    if (applied) console.log(`  + Checker ${checkerId} added to "${group.name ?? 'approvers'}"`)
    return applied
}

// Renames an existing withdrawal policy whose name no longer describes the
// rule (older ones said "1 of 2"). Everything else is sent back unchanged.
async function ensureWithdrawalPolicyName(policyId: string | undefined, withChecker: boolean) {
    if (!policyId) return
    const name = withdrawalPolicyName(withChecker)
    const policy = await api.policies.getPolicy({ policyId })
    if (policy.name === name) {
        console.log(`  ✓ Name: "${name}"`)
        return
    }
    if (policy.activityKind !== 'Wallets:Sign') throw new Error(`Policy ${policyId} is not a Wallets:Sign policy`)
    const renamed = await updateAndConfirm(policyId,
        { name, activityKind: policy.activityKind, rule: policy.rule, action: policy.action, filters: policy.filters },
        p => p.name === name, 'Rename')
    if (renamed) console.log(`  + Renamed "${policy.name}" → "${name}"`)
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
    const checker = await ensureCheckerApprover(withdrawal)
    await ensureWithdrawalPolicyName(withdrawal, checker)
    const quarantine = await ensureQuarantinePolicy()

    console.log(`
IDs saved to .env.

  Vault              ${vault.vaultId} (tag ${TAG})
  Fund this address  ${vault.address}
    → Sepolia ETH from a faucet
  Withdrawals        ${withdrawal ?? 'no policy yet: set APPROVER_USER_IDS and re-run'}
    → ${withdrawal ? withdrawalPolicyName(checker).replace('Custody demo: ', '') : ''} on every transfer from the vault
    → checker ${checker ? 'is an approver: run npm run checker' : 'not set up yet (see above)'}
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
