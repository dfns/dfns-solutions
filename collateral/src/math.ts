// Pure loan math, kept free of I/O so it can be unit tested.
// Amounts are bigint in minimum units: wei for ETH, 1e-6 for PYUSD.

export const WEI_PER_ETH = 10n ** 18n
const YEAR_MS = 365n * 24n * 3600n * 1000n
const BPS = 10_000n
// Prices are carried as fixed-point USD with 8 decimals, like Chainlink
const PRICE_SCALE = 10n ** 8n

export function priceToFixed(priceUsd: number) {
    return BigInt(Math.round(priceUsd * 1e8))
}

function ceilDiv(a: bigint, b: bigint) {
    return a === 0n ? 0n : (a + b - 1n) / b
}

// USD value of a wei amount, in loan-asset units
export function collateralValue(wei: bigint, priceUsd: number, loanDecimals: number) {
    return (wei * priceToFixed(priceUsd) * 10n ** BigInt(loanDecimals)) / (WEI_PER_ETH * PRICE_SCALE)
}

// Simple interest on the principal from openedAt, minus what was repaid.
// Accrual stops at `until` (set when a full repayment is sent).
export function outstandingDebt(args: { principal: bigint; repaid: bigint; aprBps: number; openedAt: number; now: number; until?: number }) {
    const end = Math.min(args.now, args.until ?? args.now)
    const elapsed = BigInt(Math.max(0, end - args.openedAt))
    const interest = (args.principal * BigInt(args.aprBps) * elapsed) / (BPS * YEAR_MS)
    const debt = args.principal + interest - args.repaid
    return debt > 0n ? debt : 0n
}

export function ltv(debt: bigint, wei: bigint, priceUsd: number, loanDecimals: number) {
    const value = collateralValue(wei, priceUsd, loanDecimals)
    if (value === 0n) return debt > 0n ? Infinity : 0
    return Number(debt) / Number(value)
}

// Wei worth `amount` loan-asset units at `priceUsd`, rounded up
export function weiFor(amount: bigint, priceUsd: number, loanDecimals: number) {
    return ceilDiv(amount * WEI_PER_ETH * PRICE_SCALE, priceToFixed(priceUsd) * 10n ** BigInt(loanDecimals))
}

// Collateral seized on liquidation: the debt plus the penalty, capped at what is locked
export function seizeAmount(debt: bigint, priceUsd: number, penaltyBps: number, locked: bigint, loanDecimals: number) {
    const withPenalty = ceilDiv(debt * (BPS + BigInt(penaltyBps)), BPS)
    const wei = weiFor(withPenalty, priceUsd, loanDecimals)
    return wei < locked ? wei : locked
}

// Extra collateral needed to bring LTV back down to `targetLtv`
export function topUpForTarget(debt: bigint, priceUsd: number, targetLtv: number, locked: bigint, loanDecimals: number) {
    const targetScaled = BigInt(Math.round(targetLtv * 1e6))
    if (targetScaled === 0n) return 0n
    const neededValue = ceilDiv(debt * 1_000_000n, targetScaled)
    const needed = weiFor(neededValue, priceUsd, loanDecimals)
    return needed > locked ? needed - locked : 0n
}

// Largest principal the borrower can open with `wei` of collateral
export function maxPrincipal(wei: bigint, priceUsd: number, maxInitialLtv: number, loanDecimals: number) {
    const value = collateralValue(wei, priceUsd, loanDecimals)
    return (value * BigInt(Math.floor(maxInitialLtv * 1e6))) / 1_000_000n
}

export type RiskStatus = 'Active' | 'MarginCall'

export interface RiskThresholds {
    marginCallLtv: number
    liquidationLtv: number
    gracePeriodSec: number
}

export type RiskDecision =
    | { action: 'none' }
    | { action: 'marginCall' }
    | { action: 'cure' }
    | { action: 'liquidate'; reason: 'ltv' | 'grace' }

// What the risk engine should do with one open loan on this tick
export function evaluateRisk(status: RiskStatus, currentLtv: number, t: RiskThresholds, marginCallAt: number | undefined, now: number): RiskDecision {
    if (currentLtv >= t.liquidationLtv) return { action: 'liquidate', reason: 'ltv' }
    if (status === 'Active') {
        return currentLtv >= t.marginCallLtv ? { action: 'marginCall' } : { action: 'none' }
    }
    if (currentLtv < t.marginCallLtv) return { action: 'cure' }
    if (marginCallAt !== undefined && now - marginCallAt >= t.gracePeriodSec * 1000) {
        return { action: 'liquidate', reason: 'grace' }
    }
    return { action: 'none' }
}
