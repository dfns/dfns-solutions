// Keeps the custody state in sync with Dfns by polling, and records each
// status change once on the timeline. Polling is enough for the demo and needs
// no public URL. Everything that talks to the read APIs on a timer lives here,
// so Dfns webhooks (vault.event.created, wallet.transfer.*,
// policy.approval.*) can replace it without touching the rest.
import { api, vaults, listVaultHistory, errorDetail, type VaultHistoryItem } from './dfns.js'
import { env } from './env.js'
import { record } from './events.js'
import { NATIVE_ETH, display } from './units.js'

const POLL_MS = 10_000
const NETWORK = 'EthereumSepolia'
const HISTORY_PAGE = 50

type Balances = Record<string, Record<string, string>> // tid → kind → amount

export interface CustodyState {
    updatedAt?: string
    vault?: { id: string; address: string; walletId: string }
    balances: Balances
    quarantines: { id: string; status: string; amount?: string; tid?: string; txHash?: string; senders?: string[]; dateCreated?: string }[]
    // Recent deposits, released ones included, so a release stays visible
    deposits: { quarantineId: string; status: string; amount: string; tid: string; txHash: string; senders: string[]; timestamp: string; dateReleased?: string }[]
    withdrawals: {
        transferId: string; status: string; amount: string; to?: string; txHash?: string; approvalId?: string; requester?: string; reason?: string
        // When each stage was reached, from the transfer request itself
        dateRequested?: string; datePolicyResolved?: string; dateBroadcasted?: string; dateConfirmed?: string
    }[]
    approvals: { id: string; activity: string; ref?: string; summary: string; dateCreated?: string; decisions: { userId: string; value: string }[] }[]
    // A failing source (e.g. a missing permission) doesn't hide the others
    errors: Record<string, string>
}

export const state: CustodyState = { balances: {}, quarantines: [], deposits: [], withdrawals: [], approvals: [], errors: {} }

// Last status seen per object, so each change is recorded once. Empty until
// the first poll, which only seeds it: the timeline starts at startup.
const seen = new Map<string, string>()
let seeded = false

function transition(key: string, status: string, entry: Parameters<typeof record>[0]) {
    if (seen.get(key) === status) return
    seen.set(key, status)
    if (seeded) record({ ...entry, status })
}

const vaultId = () => env('VAULT_ID')

async function vaultInfo() {
    if (state.vault) return state.vault
    const vault = await vaults.getVault({ vaultId: vaultId() })
    const entry = vault.addresses?.find(a => a.network === NETWORK)
    if (!entry) throw new Error(`Vault ${vaultId()} has no ${NETWORK} address. Run 'npm run setup'.`)
    return (state.vault = { id: vault.id, address: entry.address, walletId: entry.walletId })
}

async function balances() {
    const out: Balances = {}
    let paginationToken: string | undefined
    do {
        const page = await vaults.listVaultBalances({ vaultId: vaultId(), query: { paginationToken } })
        for (const b of page.items) {
            const byKind = (out[b.tid] ??= {})
            byKind[b.kind] = (BigInt(byKind[b.kind] ?? '0') + BigInt(b.amount)).toString()
        }
        paginationToken = page.nextPageToken
    } while (paginationToken)
    return out
}

// Deposits: Quarantined → PendingPolicyApproval (release requested) → Released
function trackDeposit(item: Extract<VaultHistoryItem, { kind: 'IncomingTransfer' }>) {
    const amount = display(item.amount, item.tid, item.incomingTransfer.asset)
    const from = item.incomingTransfer.senders.join(', ') || 'unknown sender'
    const titles = {
        Quarantined: `Deposit of ${amount} from ${from} quarantined`,
        PendingPolicyApproval: `Release of ${amount} requested, awaiting approval`,
        Released: `Deposit of ${amount} released: now Available`,
    }
    transition(item.quarantine.id, item.status, { kind: 'deposit', ref: item.quarantine.id, title: titles[item.status], txHash: item.incomingTransfer.txHash })
}

// Withdrawals: Pending → Executing → Broadcasted → Confirmed, or Failed /
// Rejected. The transfer request has finer statuses than the history item.
function trackWithdrawal(item: Extract<VaultHistoryItem, { kind: 'OutgoingTransfer' }>) {
    const t = item.transferRequest
    const amount = display(item.amount, item.tid)
    const to = 'to' in t.requestBody ? ` to ${t.requestBody.to}` : ''
    const titles: Record<string, string> = {
        Pending: `Withdrawal of ${amount}${to} pending approval`,
        Executing: `Withdrawal of ${amount} approved, signing`,
        Broadcasted: `Withdrawal of ${amount} broadcasted`,
        Confirmed: `Withdrawal of ${amount}${to} confirmed on chain`,
        Failed: `Withdrawal of ${amount} failed${t.reason ? `: ${t.reason}` : ''}`,
        Rejected: `Withdrawal of ${amount} rejected by an approver`,
    }
    transition(t.id, t.status, { kind: 'withdrawal', ref: t.id, title: titles[t.status] ?? `Withdrawal ${t.status}`, txHash: t.txHash })
}

async function history() {
    const { items } = await listVaultHistory(vaultId(), { limit: HISTORY_PAGE })
    // Oldest first, so the timeline reads in order
    for (const item of [...items].reverse()) {
        if (item.kind === 'IncomingTransfer') trackDeposit(item)
        else if (item.kind === 'OutgoingTransfer') trackWithdrawal(item)
    }
    return items
}

async function quarantines(items: VaultHistoryItem[], bal: Promise<Balances>) {
    const { items: qs } = await vaults.listVaultQuarantines({ vaultId: vaultId() })
    const deposits = new Map(items.flatMap(i => i.kind === 'IncomingTransfer' ? [[i.quarantine.id, i] as const] : []))
    await bal
    return qs.filter(q => !q.dateReleased).map(q => {
        const d = deposits.get(q.id)
        return { id: q.id, status: d?.status ?? 'Quarantined', amount: d?.amount, tid: d?.tid, txHash: q.transactionHash, senders: d?.incomingTransfer.senders, dateCreated: q.dateCreated }
    })
}

function withdrawals(items: VaultHistoryItem[]): CustodyState['withdrawals'] {
    return items.flatMap(i => i.kind !== 'OutgoingTransfer' ? [] : [{
        transferId: i.transferRequest.id,
        status: i.transferRequest.status,
        amount: i.amount,
        to: 'to' in i.transferRequest.requestBody ? i.transferRequest.requestBody.to : undefined,
        txHash: i.transferRequest.txHash,
        approvalId: i.transferRequest.approvalId,
        requester: i.transferRequest.requester.userId,
        reason: i.transferRequest.reason,
        dateRequested: i.transferRequest.dateRequested,
        datePolicyResolved: i.transferRequest.datePolicyResolved,
        dateBroadcasted: i.transferRequest.dateBroadcasted,
        dateConfirmed: i.transferRequest.dateConfirmed,
    }])
}

function deposits(items: VaultHistoryItem[]): CustodyState['deposits'] {
    return items.flatMap(i => i.kind !== 'IncomingTransfer' ? [] : [{
        quarantineId: i.quarantine.id,
        status: i.status,
        amount: i.amount,
        tid: i.tid,
        txHash: i.incomingTransfer.txHash,
        senders: i.incomingTransfer.senders,
        timestamp: i.timestamp,
        dateReleased: i.quarantine.dateReleased,
    }])
}

// Pending approvals on this vault: withdrawals from its wallet and releases
// of its quarantines. Needs Policies:Evaluations:Read on the backend account.
async function approvals(walletId: string) {
    const { items } = await api.policies.listApprovals({ query: { status: 'Pending' } })
    const mine = items.flatMap((a): CustodyState['approvals'] => {
        const act = a.activity
        if (act.kind === 'Wallets:Sign' && act.transferRequest?.walletId === walletId) {
            const t = act.transferRequest
            const body = t.requestBody
            const what = body.kind === 'Native' ? display(body.amount, NATIVE_ETH) : `a ${body.kind} transfer`
            return [{ id: a.id, activity: act.kind, ref: t.id, summary: `Withdrawal of ${what}${'to' in body ? ` to ${body.to}` : ''}`, dateCreated: a.dateCreated, decisions: a.decisions }]
        }
        if (act.kind === 'Vaults:ReleaseQuarantine' && act.releaseQuarantineRequest.vaultId === vaultId()) {
            const r = act.releaseQuarantineRequest
            return [{ id: a.id, activity: act.kind, ref: r.quarantineId, summary: `Release of quarantine ${r.quarantineId}`, dateCreated: a.dateCreated, decisions: a.decisions }]
        }
        return []
    })
    for (const a of mine) transition(a.id, 'Pending', { kind: 'approval', ref: a.id, title: `Approval requested: ${a.summary}` })
    // Approvals that left the pending list were decided (or expired): fetch
    // each one once to say how
    const pendingIds = new Set(mine.map(a => a.id))
    for (const prev of state.approvals.filter(a => !pendingIds.has(a.id))) {
        const done = await api.policies.getApproval({ approvalId: prev.id })
        const by = done.decisions.map(d => `${d.userId} ${d.value}`).join(', ')
        transition(prev.id, done.status, { kind: 'approval', ref: prev.id, title: `Approval ${done.status.toLowerCase()}: ${prev.summary}${by ? ` (${by})` : ''}` })
    }
    return mine
}

async function poll() {
    const vault = await vaultInfo()
    const bal = balances()
    const results = await Promise.allSettled([bal, history()])
    const [balResult, historyResult] = results
    const items = historyResult.status === 'fulfilled' ? historyResult.value : []
    const [qResult, aResult] = await Promise.allSettled([quarantines(items, bal.catch(() => ({}))), approvals(vault.walletId)])

    const errors: Record<string, string> = {}
    const take = <T>(name: string, r: PromiseSettledResult<T>, fallback: T) => {
        if (r.status === 'fulfilled') return r.value
        errors[name] = errorDetail(r.reason).message
        return fallback
    }
    state.balances = take('balances', balResult, state.balances)
    if (historyResult.status === 'fulfilled') {
        state.withdrawals = withdrawals(items)
        state.deposits = deposits(items)
    }
    else take('history', historyResult, undefined)
    state.quarantines = take('quarantines', qResult, state.quarantines)
    state.approvals = take('approvals', aResult, state.approvals)
    state.errors = errors
    state.updatedAt = new Date().toISOString()

    // A new failure is worth one timeline line; a persisting one isn't
    for (const [name, message] of Object.entries(errors)) {
        transition(`error:${name}`, message, { kind: 'error', title: `Polling ${name} failed: ${message}` })
    }
    for (const name of ['balances', 'history', 'quarantines', 'approvals']) {
        if (!errors[name]) seen.delete(`error:${name}`)
    }
    if (!seeded) {
        seeded = true
        record({ kind: 'action', title: `Polling vault ${vault.id} every ${POLL_MS / 1000}s: ${state.quarantines.length} pending quarantine(s), ${state.approvals.length} pending approval(s)` })
    }
}

// Serialized: an action can ask for a refresh while a timed poll is running
let running: Promise<void> | null = null
// Shown once per distinct message, so a blocked network or bad token is
// visible in the terminal without repeating every poll
let lastFailure: string | undefined
export function refresh() {
    running ??= poll()
        .then(() => { lastFailure = undefined })
        .catch(e => {
            const message = errorDetail(e).message
            state.errors = { ...state.errors, vault: message }
            if (message !== lastFailure) record({ kind: 'error', title: `Polling failed: ${message}` })
            lastFailure = message
        })
        .finally(() => { running = null })
    return running
}

export function startPoller() {
    refresh()
    setInterval(refresh, POLL_MS)
}
