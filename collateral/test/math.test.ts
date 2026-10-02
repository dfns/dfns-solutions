import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEther, parseUnits } from 'viem'
import { collateralValue, outstandingDebt, ltv, seizeAmount, topUpForTarget, maxPrincipal, weiFor, evaluateRisk } from '../src/math.js'

const D = 6
const usd = (v: string) => parseUnits(v, D)
const YEAR = 365 * 24 * 3600 * 1000
const thresholds = { marginCallLtv: 0.7, liquidationLtv: 0.85, gracePeriodSec: 300 }

test('collateral value at price', () => {
    assert.equal(collateralValue(parseEther('1'), 3000, D), usd('3000'))
    assert.equal(collateralValue(parseEther('0.5'), 2500.5, D), usd('1250.25'))
})

test('simple interest accrues on the principal and repayments reduce debt', () => {
    const base = { principal: usd('1000'), repaid: 0n, aprBps: 800, openedAt: 0 }
    assert.equal(outstandingDebt({ ...base, now: 0 }), usd('1000'))
    assert.equal(outstandingDebt({ ...base, now: YEAR }), usd('1080'))
    assert.equal(outstandingDebt({ ...base, now: YEAR / 2, repaid: usd('100') }), usd('940'))
    assert.equal(outstandingDebt({ ...base, now: YEAR, repaid: usd('5000') }), 0n)
})

test('interest stops accruing at `until`', () => {
    const debt = outstandingDebt({ principal: usd('1000'), repaid: 0n, aprBps: 800, openedAt: 0, now: YEAR, until: YEAR / 2 })
    assert.equal(debt, usd('1040'))
})

test('ltv', () => {
    assert.equal(ltv(usd('1500'), parseEther('1'), 3000, D), 0.5)
    assert.equal(ltv(0n, 0n, 3000, D), 0)
    assert.equal(ltv(usd('1'), 0n, 3000, D), Infinity)
})

test('weiFor rounds up', () => {
    assert.equal(weiFor(usd('3000'), 3000, D), parseEther('1'))
    assert.equal(weiFor(1n, 3000, D) > 0n, true)
})

test('seize amount is debt plus penalty, capped at the locked amount', () => {
    // 1500 debt + 5% = 1575 USD at 2000 USD/ETH = 0.7875 ETH
    assert.equal(seizeAmount(usd('1500'), 2000, 500, parseEther('1'), D), parseEther('0.7875'))
    // Underwater: everything locked is seized
    assert.equal(seizeAmount(usd('1500'), 1000, 500, parseEther('1'), D), parseEther('1'))
})

test('top-up needed to reach the target LTV', () => {
    // Debt 1500, target 50% → 3000 USD of collateral = 1.5 ETH at 2000, 1 ETH locked
    assert.equal(topUpForTarget(usd('1500'), 2000, 0.5, parseEther('1'), D), parseEther('0.5'))
    assert.equal(topUpForTarget(usd('100'), 2000, 0.5, parseEther('1'), D), 0n)
})

test('max principal at the initial LTV cap', () => {
    assert.equal(maxPrincipal(parseEther('1'), 3000, 0.5, D), usd('1500'))
})

test('risk: Active stays Active below the margin call threshold', () => {
    assert.deepEqual(evaluateRisk('Active', 0.69, thresholds, undefined, 0), { action: 'none' })
})

test('risk: Active enters MarginCall', () => {
    assert.deepEqual(evaluateRisk('Active', 0.7, thresholds, undefined, 0), { action: 'marginCall' })
})

test('risk: jumps straight to liquidation above the liquidation threshold', () => {
    assert.deepEqual(evaluateRisk('Active', 0.9, thresholds, undefined, 0), { action: 'liquidate', reason: 'ltv' })
    assert.deepEqual(evaluateRisk('MarginCall', 0.85, thresholds, 0, 1000), { action: 'liquidate', reason: 'ltv' })
})

test('risk: MarginCall cures when LTV drops back', () => {
    assert.deepEqual(evaluateRisk('MarginCall', 0.6, thresholds, 0, 1000), { action: 'cure' })
})

test('risk: MarginCall liquidates once the grace period expires', () => {
    assert.deepEqual(evaluateRisk('MarginCall', 0.75, thresholds, 0, 299_999), { action: 'none' })
    assert.deepEqual(evaluateRisk('MarginCall', 0.75, thresholds, 0, 300_000), { action: 'liquidate', reason: 'grace' })
})
