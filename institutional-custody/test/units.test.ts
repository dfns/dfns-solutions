import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseUnits, formatUnits, display } from '../src/units.js'

test('parseUnits converts ETH to wei exactly', () => {
    assert.equal(parseUnits('1', 18), 10n ** 18n)
    assert.equal(parseUnits('0.01', 18), 10n ** 16n)
    assert.equal(parseUnits('0.000000000000000001', 18), 1n)
})

test('parseUnits rejects what is not a plain decimal amount', () => {
    assert.throws(() => parseUnits('1e18', 18))
    assert.throws(() => parseUnits('-1', 18))
    assert.throws(() => parseUnits('', 18))
    assert.throws(() => parseUnits('0.0000000000000000001', 18))
})

test('formatUnits is exact and trims trailing zeros', () => {
    assert.equal(formatUnits(10n ** 16n, 18), '0.01')
    assert.equal(formatUnits('89980000000000000', 18), '0.08998')
    assert.equal(formatUnits('1', 18), '0.000000000000000001')
    assert.equal(formatUnits(5n * 10n ** 18n, 18), '5')
    assert.equal(formatUnits('0', 18), '0')
})

test('display shows ETH, and raw units for unknown assets', () => {
    assert.equal(display('10000000000000000', 'native:eth'), '0.01 ETH')
    assert.equal(display('42', 'erc20:0xabc'), '42 erc20:0xabc (min units)')
    assert.equal(display('1500000', 'erc20:0xabc', { symbol: 'USDC', decimals: 6 }), '1.5 USDC')
})
