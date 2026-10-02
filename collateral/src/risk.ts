import { DfnsError } from '@dfns/sdk'
import { lenderApi, ids, errorDetail, lenderVaults } from './dfns.js'
import { config } from './config.js'
import { record, broadcast } from './events.js'
import { getPrice } from './price.js'
import { allLoans, withLoan } from './store.js'
import { evaluateRisk, ltv } from './math.js'
import { debtOf, liquidateLoan, watchLiquidation, viewLoan } from './loans.js'

let timer: NodeJS.Timeout | null = null
let running = false
// Errors repeat every tick; only put a new one on the timeline
const lastErrors = new Map<string, string>()

function recordError(key: string, title: string, e: unknown, loanId?: string) {
    const detail = errorDetail(e)
    if (lastErrors.get(key) === detail.message) return
    lastErrors.set(key, detail.message)
    record({ actor: 'risk', kind: 'error', title, loanId, response: detail })
}

// One risk pass: price → LTV for each open loan → state transitions.
// LTV uses the locked amount read back from Dfns, not our own copy.
export async function tick() {
    if (running) return
    running = true
    try {
        const quote = await getPrice()
        const now = Date.now()

        for (const loan of allLoans()) {
            if (loan.status === 'Liquidating') { void watchLiquidation(loan.id); continue }
            if (loan.status !== 'Active' && loan.status !== 'MarginCall') continue
            if (loan.busy || !loan.lockId) continue

            const decision = await withLoan(loan.id, async l => {
                if (l.status !== 'Active' && l.status !== 'MarginCall') return null
                try {
                    const lock = await lenderVaults.getVaultLock({ vaultId: ids.borrowerVault, lockId: l.lockId! })
                    if (lock.dateDeleted) {
                        l.lastError = `Lock ${lock.id} no longer exists`
                        return null
                    }
                    l.lockedWei = lock.amount
                } catch (e) {
                    if (e instanceof DfnsError && e.httpStatus === 404) l.lastError = `Lock ${l.lockId} not found`
                    throw e
                }

                const current = ltv(debtOf(l, now), BigInt(l.lockedWei), quote.price, config.loanAsset.decimals)
                const d = evaluateRisk(l.status, current, config, l.marginCallAt, now)
                const pct = (current * 100).toFixed(1)

                if (d.action === 'marginCall') {
                    l.status = 'MarginCall'
                    l.marginCallAt = now
                    record({ actor: 'risk', kind: 'transition', title: `Active → MarginCall: LTV ${pct}% ≥ ${config.marginCallLtv * 100}%. Grace period ${config.gracePeriodSec}s`, loanId: l.id })
                } else if (d.action === 'cure') {
                    l.status = 'Active'
                    delete l.marginCallAt
                    delete l.liquidationDue
                    record({ actor: 'risk', kind: 'transition', title: `MarginCall → Active: LTV back to ${pct}%`, loanId: l.id })
                } else if (d.action === 'liquidate') {
                    const why = d.reason === 'ltv' ? `LTV ${pct}% ≥ ${config.liquidationLtv * 100}%` : 'grace period expired'
                    if (config.autoLiquidate) return why
                    if (!l.liquidationDue) {
                        l.liquidationDue = true
                        record({ actor: 'risk', kind: 'info', title: `Liquidation due (${why}). Waiting for the lender`, loanId: l.id })
                    }
                }
                return null
            }).then(r => { lastErrors.delete(loan.id); return r }).catch(e => {
                recordError(loan.id, 'Risk check failed', e, loan.id)
                return null
            })

            if (decision) {
                await liquidateLoan(loan.id, 'risk', `Auto-liquidation: ${decision}`).catch(() => {
                    // Already on the timeline via call()
                })
            }
        }

        broadcast('tick', {
            price: quote,
            loans: allLoans().map(l => viewLoan(l, quote.price, now)),
        })
        lastErrors.delete('tick')
    } catch (e) {
        recordError('tick', 'Risk engine tick failed', e)
    } finally {
        running = false
    }
}

export function startRiskEngine() {
    const loop = async () => {
        await tick()
        timer = setTimeout(loop, config.riskIntervalSec * 1000)
    }
    void loop()
}

export function stopRiskEngine() {
    if (timer) clearTimeout(timer)
}
