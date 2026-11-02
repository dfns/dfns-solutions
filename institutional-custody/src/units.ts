// Amounts are strings in minimum units (wei for ETH). Exact string math, no
// floats, so audit figures never pick up rounding.

export const NATIVE_ETH = 'native:eth'

export function parseUnits(value: string, decimals: number) {
    if (!/^\d+(\.\d+)?$/.test(value)) throw new Error(`"${value}" is not a decimal amount, e.g. "0.01"`)
    const [whole, frac = ''] = value.split('.')
    if (frac.length > decimals) throw new Error(`"${value}" has more than ${decimals} decimals`)
    return BigInt(whole + frac.padEnd(decimals, '0'))
}

export function formatUnits(amount: string | bigint, decimals: number) {
    const s = amount.toString().padStart(decimals + 1, '0')
    const whole = s.slice(0, s.length - decimals)
    const frac = s.slice(s.length - decimals).replace(/0+$/, '')
    return frac ? `${whole}.${frac}` : whole
}

// Symbol and decimals for an asset, when known; native ETH is the only one
// the demo vault holds
export function assetOf(tid: string, hint?: { symbol?: string; decimals?: number }) {
    if (tid === NATIVE_ETH) return { symbol: 'ETH', decimals: 18 }
    return { symbol: hint?.symbol ?? tid, decimals: hint?.decimals }
}

export function display(amount: string, tid: string, hint?: { symbol?: string; decimals?: number }) {
    const { symbol, decimals } = assetOf(tid, hint)
    return decimals === undefined ? `${amount} ${symbol} (min units)` : `${formatUnits(amount, decimals)} ${symbol}`
}
