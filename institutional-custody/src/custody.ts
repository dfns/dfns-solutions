// What custody operations can do: withdraw, release a deposit, export the
// ledger. Each action is recorded on the timeline; its later status changes
// come from the poller.
import { vaults, listVaultHistory, type VaultHistoryItem } from './dfns.js'
import { env } from './env.js'
import { record } from './events.js'
import { refresh } from './poller.js'
import { NATIVE_ETH, assetOf, display, formatUnits } from './units.js'

const NETWORK = 'EthereumSepolia'
const vaultId = () => env('VAULT_ID')

// Sends Available ETH out of the vault. With the withdrawal policy on the
// vault's wallet, Dfns answers at once with status Pending and an approval id;
// the poller follows it through approval, broadcast and confirmation.
export async function withdraw(amountWei: bigint, to: string) {
    const transfer = await vaults.createVaultTransfer({
        vaultId: vaultId(),
        body: { network: NETWORK, tid: NATIVE_ETH, to, amount: amountWei.toString() },
    })
    record({ kind: 'action', ref: transfer.id, status: transfer.status, title: `Withdrawal of ${display(amountWei.toString(), NATIVE_ETH)} to ${to} requested (${transfer.status})` })
    refresh()
    return transfer
}

// Asks for quarantined funds to be released. The release-quarantine policy
// holds it for a person's approval; the requester can't approve their own.
export async function releaseQuarantine(quarantineId: string, reason: string) {
    const request = await vaults.releaseQuarantine({ vaultId: vaultId(), quarantineId, body: { reason } })
    record({ kind: 'action', ref: quarantineId, status: request.status, title: `Release of ${quarantineId} requested: "${reason}" (${request.status})` })
    refresh()
    return request
}

// The vault's full history, newest first, every page
async function fullHistory() {
    const items: VaultHistoryItem[] = []
    let paginationToken: string | undefined
    do {
        const page = await listVaultHistory(vaultId(), { limit: 500, paginationToken })
        items.push(...page.items)
        paginationToken = page.nextPageToken
    } while (paginationToken)
    return items
}

const CSV_COLUMNS = ['date', 'kind', 'amount', 'asset', 'counterparty', 'tx_hash', 'status', 'requester']

function csvCell(value: string | undefined) {
    const v = value ?? ''
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function auditRow(item: VaultHistoryItem) {
    const hint = item.kind === 'IncomingTransfer' ? item.incomingTransfer.asset : undefined
    const { symbol, decimals } = assetOf(item.tid, hint)
    const amount = decimals === undefined ? item.amount : formatUnits(item.amount, decimals)
    const base = { date: item.timestamp, kind: item.kind, amount, asset: decimals === undefined ? `${symbol} (min units)` : symbol }
    switch (item.kind) {
        case 'IncomingTransfer':
            return { ...base, counterparty: item.incomingTransfer.senders.join(' '), tx_hash: item.incomingTransfer.txHash, status: item.status, requester: '' }
        case 'OutgoingTransfer': {
            const t = item.transferRequest
            return { ...base, counterparty: 'to' in t.requestBody ? t.requestBody.to : '', tx_hash: t.txHash ?? '', status: t.status, requester: t.requester.userId }
        }
        default:
            return { ...base, counterparty: `lock ${item.lock.id}`, tx_hash: '', status: '', requester: '' }
    }
}

// The vault's ledger as CSV, oldest first, for auditors and reconciliation
export async function auditCsv() {
    const rows = (await fullHistory()).reverse().map(auditRow)
    const lines = rows.map(r => CSV_COLUMNS.map(c => csvCell((r as Record<string, string>)[c])).join(','))
    return [CSV_COLUMNS.join(','), ...lines].join('\n') + '\n'
}
