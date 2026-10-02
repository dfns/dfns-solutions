import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_PATH = path.join(__dirname, '..', 'data', 'loans.json')

export type LoanStatus = 'Requested' | 'Rejected' | 'Active' | 'MarginCall' | 'Liquidating' | 'Liquidated' | 'Repaid'

export interface Payment {
    kind: 'payout' | 'repayment'
    amount: string
    transferId: string
    txHash?: string
    at: string
}

export interface Loan {
    id: string
    status: LoanStatus
    createdAt: string
    // Amounts are strings in minimum units (wei / PYUSD 1e-6)
    collateralWei: string
    principal: string
    repaid: string
    aprBps: number
    lockId?: string
    // Lock externalIds can't be reused, so each approval attempt gets its own
    approvalAttempts?: number
    lockedWei?: string
    openedAt?: number
    // Interest stops accruing once a full repayment has been sent
    accrualStoppedAt?: number
    marginCallAt?: number
    // Set in manual liquidation mode when the engine wants the lender to act
    liquidationDue?: boolean
    pendingTopUpWei?: string
    liquidation?: {
        transferId: string
        walletId: string
        amountWei: string
        priceUsd: number
        debt: string
        reason: string
        txHash?: string
    }
    payments: Payment[]
    // Short label for an operation in progress, shown in the UI
    busy?: string
    lastError?: string
    closedAt?: string
}

const loans = new Map<string, Loan>()

function load() {
    if (!fs.existsSync(DATA_PATH)) return
    for (const loan of JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')) as Loan[]) {
        // Operations don't survive a restart, so their busy flag doesn't either
        delete loan.busy
        loans.set(loan.id, loan)
    }
}

export function save() {
    fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true })
    fs.writeFileSync(DATA_PATH, JSON.stringify([...loans.values()], null, 2))
}

export function allLoans() {
    return [...loans.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getLoan(id: string) {
    const loan = loans.get(id)
    if (!loan) throw Object.assign(new Error(`Loan ${id} not found`), { status: 404 })
    return loan
}

export function addLoan(loan: Loan) {
    loans.set(loan.id, loan)
    save()
}

// Serialises operations per loan, so the risk engine and a user action can't
// both act on the same lock at once.
const queues = new Map<string, Promise<unknown>>()

export function withLoan<T>(id: string, fn: (loan: Loan) => Promise<T>): Promise<T> {
    const prev = queues.get(id) ?? Promise.resolve()
    const next = prev.catch(() => {}).then(() => fn(getLoan(id))).finally(save)
    queues.set(id, next)
    return next
}

load()
