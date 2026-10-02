import { borrowerApi, lenderApi, ids, call, waitForTransfer, borrowerVaults, lenderVaults } from './dfns.js'
import { config } from './config.js'
import { record, type Actor } from './events.js'

// Both actors hold everything in a Dfns vault: the borrower's holds the ETH
// collateral and the PYUSD it borrowed, the lender's holds the loan book and
// receives repayments and seized collateral. Every incoming transfer lands as
// Quarantined and has to be released before it can be spent.
export type Party = Extract<Actor, 'borrower' | 'lender'>

type BalanceKind = 'Available' | 'Outgoing' | 'Fee' | 'Incoming' | 'Locked' | 'Quarantined'
type Balances = Record<BalanceKind, bigint>

const vaultId = (party: Party) => party === 'borrower' ? ids.borrowerVault : ids.lenderVault
const vaults = (party: Party) => party === 'borrower' ? borrowerVaults : lenderVaults
const api = (party: Party) => party === 'borrower' ? borrowerApi : lenderApi

export const loanAssetTid = () => `erc20:${config.loanAsset.contract.toLowerCase()}`
const sameTid = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const emptyBalances = (): Balances => ({ Available: 0n, Outgoing: 0n, Fee: 0n, Incoming: 0n, Locked: 0n, Quarantined: 0n })

const addresses = new Map<Party, { address: string; walletId: string }>()

// The vault's EVM address, created by `npm run setup`
export async function getVaultAddress(party: Party) {
    if (addresses.has(party)) return addresses.get(party)!
    const id = vaultId(party)
    const vault = await vaults(party).getVault({ vaultId: id })
    const entry = vault.addresses?.find(a => a.network === config.network)
    if (!entry) throw new Error(`Vault ${id} has no ${config.network} address. Run 'npm run setup'.`)
    addresses.set(party, { address: entry.address, walletId: entry.walletId })
    return addresses.get(party)!
}

async function listBalances(party: Party, tid?: string) {
    const items: Awaited<ReturnType<typeof borrowerVaults.listVaultBalances>>['items'] = []
    let paginationToken: string | undefined
    do {
        const page = await vaults(party).listVaultBalances({
            vaultId: vaultId(party),
            query: { network: config.network, tid, paginationToken },
        })
        items.push(...page.items)
        paginationToken = page.nextPageToken
    } while (paginationToken)
    return items
}

function totals(items: { kind: BalanceKind; amount: string }[]) {
    const out = emptyBalances()
    for (const b of items) out[b.kind] += BigInt(b.amount)
    return out
}

// Borrower collateral (ETH) balances in wei, by kind
export async function getVaultBalances() {
    return totals(await listBalances('borrower', config.collateralTid))
}

// Available PYUSD in a vault: the only part a vault transfer can spend
export async function getLoanAssetBalance(party: Party) {
    const items = await listBalances(party)
    return totals(items.filter(b => sameTid(b.tid, loanAssetTid()))).Available
}

// Balances of both assets plus the pending quarantines, for the dashboard.
// Quarantine records don't carry the asset or amount, so they're joined with
// the vault's Quarantined balance entries.
export async function getVaultState(party: Party) {
    const [address, items, quarantines] = await Promise.all([
        getVaultAddress(party),
        listBalances(party),
        vaults(party).listVaultQuarantines({ vaultId: vaultId(party), query: { network: config.network } }),
    ])
    const eth = totals(items.filter(b => sameTid(b.tid, config.collateralTid)))
    const loanAsset = totals(items.filter(b => sameTid(b.tid, loanAssetTid())))
    const pending = quarantines.items.filter(q => !q.dateReleased).map(q => {
        const balance = items.find(b => b.kind === 'Quarantined' && b.quarantineId === q.id)
        const asset = !balance ? null : sameTid(balance.tid, config.collateralTid) ? 'ETH' : sameTid(balance.tid, loanAssetTid()) ? config.loanAsset.symbol : balance.tid
        return { id: q.id, transactionHash: q.transactionHash, dateCreated: q.dateCreated, asset, amount: balance?.amount ?? null }
    })
    const str = (b: Balances) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.toString()]))
    return { id: vaultId(party), ...address, eth: str(eth), loanAsset: str(loanAsset), quarantines: pending }
}

export async function releaseQuarantine(party: Party, quarantineId: string) {
    const request = { vaultId: vaultId(party), quarantineId, body: { reason: `${party === 'borrower' ? 'Borrower' : 'Lender'} accepts incoming funds` } }
    return call(party, 'vaults.releaseQuarantine', request, () => vaults(party).releaseQuarantine(request))
}

// Sends Available funds out of a vault and waits for the transfer to confirm
export async function vaultTransfer(party: Party, opts: { tid: string; to: string; amount: bigint; externalId?: string; title: string; loanId?: string }) {
    const request = {
        vaultId: vaultId(party),
        body: { network: config.network, tid: opts.tid, to: opts.to, amount: opts.amount.toString(), externalId: opts.externalId },
    }
    const transfer = await call(party, `vaults.createVaultTransfer (${opts.title})`, request, () => vaults(party).createVaultTransfer(request), opts.loanId)
    const confirmed = await waitForTransfer(api(party), transfer.walletId, transfer.id)
    return { ...confirmed, id: transfer.id }
}

// Withdraw Available ETH from the borrower vault to an external address
export async function withdrawFromVault(amountWei: bigint, to: string) {
    const confirmed = await vaultTransfer('borrower', { tid: config.collateralTid, to, amount: amountWei, title: 'withdraw' })
    record({ actor: 'borrower', kind: 'info', title: 'Withdrawal confirmed', txHash: confirmed.txHash })
    return confirmed
}
