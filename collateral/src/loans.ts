import { randomUUID } from 'crypto'
import { DfnsError } from '@dfns/sdk'
import { formatEther, formatUnits, parseEther } from 'viem'
import { lenderApi, ids, call, errorDetail, lenderVaults } from './dfns.js'
import { config } from './config.js'
import { record, type Actor } from './events.js'
import { getPrice } from './price.js'
import { addLoan, allLoans, getLoan, withLoan, save, type Loan } from './store.js'
import { getVaultBalances, getVaultAddress, getLoanAssetBalance, vaultTransfer, loanAssetTid } from './vault.js'
import { outstandingDebt, ltv, collateralValue, seizeAmount, topUpForTarget, maxPrincipal } from './math.js'

const OPEN = ['Active', 'MarginCall'] as const

const eth = (wei: bigint | string) => `${formatEther(BigInt(wei))} ETH`
const usd = (units: bigint | string) => `${formatUnits(BigInt(units), config.loanAsset.decimals)} ${config.loanAsset.symbol}`

function httpError(status: number, message: string) {
    return Object.assign(new Error(message), { status })
}

function assertStatus(loan: Loan, ...allowed: Loan['status'][]) {
    if (!allowed.includes(loan.status)) throw httpError(409, `Loan ${loan.id} is ${loan.status}, expected ${allowed.join(' or ')}`)
    if (loan.busy) throw httpError(409, `Loan ${loan.id} is busy: ${loan.busy}`)
}

function transition(loan: Loan, to: Loan['status'], actor: Actor, why: string) {
    const from = loan.status
    loan.status = to
    record({ actor, kind: 'transition', title: `${from} → ${to}: ${why}`, loanId: loan.id })
}

export function debtOf(loan: Loan, now = Date.now()) {
    if (!loan.openedAt || (!OPEN.includes(loan.status as any) && loan.status !== 'Liquidating')) return 0n
    return outstandingDebt({
        principal: BigInt(loan.principal),
        repaid: BigInt(loan.repaid),
        aprBps: loan.aprBps,
        openedAt: loan.openedAt,
        now,
        until: loan.accrualStoppedAt,
    })
}

// Collateral that is Available in the vault but already promised to a
// pending request or top-up
function reservedWei(excludeId?: string) {
    let total = 0n
    for (const l of allLoans()) {
        if (l.id === excludeId) continue
        if (l.status === 'Requested') total += BigInt(l.collateralWei)
        if (l.pendingTopUpWei) total += BigInt(l.pendingTopUpWei)
    }
    return total
}

// The vault pays its own gas, so part of Available is never pledged
async function freeCollateral(excludeId?: string) {
    const balances = await getVaultBalances()
    const free = balances.Available - reservedWei(excludeId) - parseEther(String(config.gasReserveEth))
    return free > 0n ? free : 0n
}

// Loan as sent to the UI, with debt and LTV computed at the given price
export function viewLoan(loan: Loan, price: number, now = Date.now()) {
    const d = config.loanAsset.decimals
    const locked = BigInt(loan.lockedWei ?? loan.collateralWei)
    const debt = debtOf(loan, now)
    const isOpen = OPEN.includes(loan.status as any)
    return {
        ...loan,
        debt: debt.toString(),
        collateralValue: collateralValue(locked, price, d).toString(),
        ltv: loan.status === 'Requested' ? ltv(BigInt(loan.principal), locked, price, d) : isOpen ? ltv(debt, locked, price, d) : null,
        topUpNeededWei: isOpen ? topUpForTarget(debt, price, config.targetLtv, locked, d).toString() : '0',
        graceEndsAt: loan.status === 'MarginCall' && loan.marginCallAt ? loan.marginCallAt + config.gracePeriodSec * 1000 : null,
    }
}

// ── Borrower ────────────────────────────────────────────────────────

export async function requestLoan(collateralWei: bigint, principal: bigint) {
    if (collateralWei <= 0n || principal <= 0n) throw httpError(400, 'Collateral and principal must be positive')
    const free = await freeCollateral()
    if (collateralWei > free) throw httpError(400, `Only ${eth(free)} of Available collateral is free in the vault`)
    const { price } = await getPrice()
    const max = maxPrincipal(collateralWei, price, config.maxInitialLtv, config.loanAsset.decimals)
    if (principal > max) throw httpError(400, `Initial LTV above ${config.maxInitialLtv * 100}%: max principal for this collateral is ${usd(max)}`)

    const loan: Loan = {
        id: `loan-${randomUUID()}`,
        status: 'Requested',
        createdAt: new Date().toISOString(),
        collateralWei: collateralWei.toString(),
        principal: principal.toString(),
        repaid: '0',
        aprBps: config.aprBps,
        payments: [],
    }
    addLoan(loan)
    record({ actor: 'borrower', kind: 'transition', title: `Loan requested: ${usd(principal)} against ${eth(collateralWei)}`, loanId: loan.id })
    return loan
}

export function topUpLoan(id: string, addWei: bigint) {
    return withLoan(id, async loan => {
        assertStatus(loan, ...OPEN)
        if (addWei <= 0n) throw httpError(400, 'Top-up must be positive')
        if (loan.pendingTopUpWei) throw httpError(409, 'A top-up is already waiting for the lender')
        const free = await freeCollateral(loan.id)
        if (addWei > free) throw httpError(400, `Only ${eth(free)} of Available collateral is free. Deposit and accept more ETH first`)
        if (config.autoAcceptTopUp) return increaseLock(loan, addWei)
        loan.pendingTopUpWei = addWei.toString()
        record({ actor: 'borrower', kind: 'info', title: `Top-up of ${eth(addWei)} offered, waiting for the lender to raise the lock`, loanId: loan.id })
        return loan
    })
}

export function repayLoan(id: string, amount: bigint | 'full') {
    return withLoan(id, async loan => {
        assertStatus(loan, ...OPEN)
        const now = Date.now()
        const debt = debtOf(loan, now)
        const full = amount === 'full' || amount >= debt
        const value = full ? debt : amount as bigint
        // A full repayment already landed but releasing the lock failed: retry the release
        if (full && value === 0n && loan.accrualStoppedAt) {
            await closeRepaid(loan)
            return loan
        }
        if (value <= 0n) throw httpError(400, 'Repayment must be positive')
        const balance = await getLoanAssetBalance('borrower')
        if (balance < value) throw httpError(400, `Borrower vault has ${usd(balance)} Available, needs ${usd(value)}. Accept any quarantined ${config.loanAsset.symbol} first`)

        // Freeze interest while the final repayment is in flight
        if (full) loan.accrualStoppedAt = now
        loan.busy = full ? 'Repaying in full' : 'Repaying'
        save()
        try {
            const done = await vaultTransfer('borrower', {
                tid: loanAssetTid(),
                to: (await getVaultAddress('lender')).address,
                amount: value,
                externalId: `${loan.id}-repay-${loan.payments.length}`,
                title: `repay ${config.loanAsset.symbol}`,
                loanId: loan.id,
            })
            loan.repaid = (BigInt(loan.repaid) + value).toString()
            loan.payments.push({ kind: 'repayment', amount: value.toString(), transferId: done.id, txHash: done.txHash, at: new Date().toISOString() })
            record({ actor: 'borrower', kind: 'info', title: `Repayment of ${usd(value)} confirmed`, loanId: loan.id, txHash: done.txHash })
        } catch (e) {
            delete loan.accrualStoppedAt
            loan.lastError = errorDetail(e).message
            throw e
        } finally {
            delete loan.busy
        }

        if (full) await closeRepaid(loan)
        return loan
    })
}

// ── Lender ──────────────────────────────────────────────────────────

export function approveLoan(id: string) {
    return withLoan(id, async loan => {
        assertStatus(loan, 'Requested')
        const collateral = BigInt(loan.collateralWei)
        const free = await freeCollateral(loan.id)
        if (collateral > free) throw httpError(400, `Only ${eth(free)} of Available collateral is free in the vault`)
        const lenderBalance = await getLoanAssetBalance('lender')
        if (lenderBalance < BigInt(loan.principal)) throw httpError(400, `Lender vault has ${usd(lenderBalance)} Available, needs ${usd(loan.principal)}`)

        // externalId can never be reused on a vault, even after the lock is
        // deleted, so a retried approval needs a fresh one
        const attempt = loan.approvalAttempts ?? 0
        loan.approvalAttempts = attempt + 1
        loan.busy = 'Creating lock'
        save()
        try {
            const lockRequest = {
                vaultId: ids.borrowerVault,
                body: {
                    network: config.network,
                    tid: config.collateralTid,
                    amount: loan.collateralWei,
                    beneficiary: (await getVaultAddress('lender')).address,
                    externalId: attempt ? `${loan.id}-${attempt}` : loan.id,
                    reason: `Collateral for ${loan.id}`,
                },
            }
            const lock = await call('lender', 'vaults.createVaultLock', lockRequest, () => lenderVaults.createVaultLock(lockRequest), loan.id)
            loan.lockId = lock.id
            loan.lockedWei = lock.amount
            save()

            loan.busy = `Paying out ${config.loanAsset.symbol}`
            try {
                const done = await vaultTransfer('lender', {
                    tid: loanAssetTid(),
                    to: (await getVaultAddress('borrower')).address,
                    amount: BigInt(loan.principal),
                    externalId: `${loan.id}-payout-${attempt}`,
                    title: `pay out ${config.loanAsset.symbol}`,
                    loanId: loan.id,
                })
                loan.payments.push({ kind: 'payout', amount: loan.principal, transferId: done.id, txHash: done.txHash, at: new Date().toISOString() })
                record({ actor: 'lender', kind: 'info', title: `Payout of ${usd(loan.principal)} confirmed. It lands Quarantined in the borrower vault`, loanId: loan.id, txHash: done.txHash })
            } catch (e) {
                // Opening a loan is two transactions: undo the lock if the payout fails
                const releaseRequest = { vaultId: ids.borrowerVault, lockId: lock.id }
                await call('lender', 'vaults.releaseVaultLock (payout failed, rolling back)', releaseRequest, () => lenderVaults.releaseVaultLock(releaseRequest), loan.id)
                delete loan.lockId
                delete loan.lockedWei
                throw e
            }
        } catch (e) {
            loan.lastError = errorDetail(e).message
            throw e
        } finally {
            delete loan.busy
        }

        delete loan.lastError
        loan.openedAt = Date.now()
        transition(loan, 'Active', 'lender', 'collateral locked and principal paid out')
        return loan
    })
}

export function rejectLoan(id: string) {
    return withLoan(id, async loan => {
        assertStatus(loan, 'Requested')
        loan.closedAt = new Date().toISOString()
        transition(loan, 'Rejected', 'lender', 'request declined')
        return loan
    })
}

export function acceptTopUp(id: string) {
    return withLoan(id, async loan => {
        assertStatus(loan, ...OPEN)
        if (!loan.pendingTopUpWei) throw httpError(409, 'No top-up is pending')
        const add = BigInt(loan.pendingTopUpWei)
        delete loan.pendingTopUpWei
        return increaseLock(loan, add)
    })
}

async function increaseLock(loan: Loan, addWei: bigint) {
    const current = await lenderVaults.getVaultLock({ vaultId: ids.borrowerVault, lockId: loan.lockId! })
    const request = { vaultId: ids.borrowerVault, lockId: loan.lockId!, body: { amount: (BigInt(current.amount) + addWei).toString() } }
    const replaced = await call('lender', 'vaults.replaceVaultLock (top-up)', request, () => lenderVaults.replaceVaultLock(request), loan.id)
    // A replacement creates a new lock id; keep tracking the live one
    const newId = replaced.replacedByLockId ?? replaced.id
    const fresh = await lenderVaults.getVaultLock({ vaultId: ids.borrowerVault, lockId: newId })
    loan.lockId = fresh.id
    loan.lockedWei = fresh.amount
    loan.collateralWei = fresh.amount
    record({ actor: 'lender', kind: 'info', title: `Lock raised to ${eth(fresh.amount)} (new lock ${fresh.id})`, loanId: loan.id })
    return loan
}

async function closeRepaid(loan: Loan) {
    const request = { vaultId: ids.borrowerVault, lockId: loan.lockId! }
    await call('lender', 'vaults.releaseVaultLock (loan repaid)', request, () => lenderVaults.releaseVaultLock(request), loan.id)
    loan.closedAt = new Date().toISOString()
    delete loan.marginCallAt
    delete loan.liquidationDue
    transition(loan, 'Repaid', 'lender', 'debt repaid, collateral back to Available')
}

export function liquidateLoan(id: string, actor: Actor, reason: string) {
    return withLoan(id, async loan => {
        assertStatus(loan, ...OPEN)
        // The lock itself lets the lender seize at any time; this server only
        // allows it once the risk engine has raised a margin call
        if (actor === 'lender' && loan.status !== 'MarginCall' && !loan.liquidationDue) {
            throw httpError(409, 'Liquidation is only allowed during a margin call')
        }
        const { price } = await getPrice()
        const lock = await lenderVaults.getVaultLock({ vaultId: ids.borrowerVault, lockId: loan.lockId! })
        if (lock.transferId) throw httpError(409, 'Lock transfer already in flight')
        const locked = BigInt(lock.amount)
        const debt = debtOf(loan)
        const amount = seizeAmount(debt, price, config.liquidationPenaltyBps, locked, config.loanAsset.decimals)

        const request = { vaultId: ids.borrowerVault, lockId: lock.id, body: { amount: amount.toString() } }
        const transfer = await call('lender', 'vaults.transferVaultLock (liquidate)', request, () => lenderVaults.transferVaultLock(request), loan.id)
        loan.liquidation = {
            transferId: transfer.id,
            walletId: transfer.walletId,
            amountWei: amount.toString(),
            priceUsd: price,
            debt: debt.toString(),
            reason,
        }
        delete loan.liquidationDue
        transition(loan, 'Liquidating', actor, `${reason}. Seizing ${eth(amount)} of ${eth(locked)} at $${price.toFixed(2)}`)
        void watchLiquidation(loan.id)
        return loan
    })
}

// A lock transfer stays in flight until confirmed on-chain, at which point
// Dfns deletes the lock and returns any unsent remainder to Available.
const watching = new Set<string>()

export async function watchLiquidation(id: string) {
    if (watching.has(id)) return
    watching.add(id)
    try {
        for (let i = 0; i < 200; i++) {
            const loan = getLoan(id)
            if (loan.status !== 'Liquidating' || !loan.lockId) return
            let lock: Awaited<ReturnType<typeof lenderVaults.getVaultLock>> | null = null
            try {
                lock = await lenderVaults.getVaultLock({ vaultId: ids.borrowerVault, lockId: loan.lockId })
            } catch (e) {
                if (!(e instanceof DfnsError && e.httpStatus === 404)) throw e
            }
            if (!lock || lock.dateDeleted) return finishLiquidation(id)
            if (!lock.transferId) return failLiquidation(id, 'Lock transfer failed on-chain. The lock is still in place')
            await new Promise(r => setTimeout(r, 4000))
        }
    } catch (e) {
        record({ actor: 'lender', kind: 'error', title: 'Watching the liquidation failed', loanId: id, response: errorDetail(e) })
    } finally {
        watching.delete(id)
    }
}

function finishLiquidation(id: string) {
    return withLoan(id, async loan => {
        if (loan.status !== 'Liquidating' || !loan.liquidation) return
        try {
            const t = await lenderApi.wallets.getTransfer({ walletId: loan.liquidation.walletId, transferId: loan.liquidation.transferId })
            loan.liquidation.txHash = t.txHash
        } catch { /* the tx hash is informational */ }
        loan.closedAt = new Date().toISOString()
        delete loan.marginCallAt
        transition(loan, 'Liquidated', 'lender', `${eth(loan.liquidation.amountWei)} sent to the lender vault (lands Quarantined), remainder back to Available`)
    })
}

function failLiquidation(id: string, message: string) {
    return withLoan(id, async loan => {
        if (loan.status !== 'Liquidating') return
        delete loan.liquidation
        loan.lastError = message
        loan.marginCallAt ??= Date.now()
        transition(loan, 'MarginCall', 'lender', message)
    })
}
