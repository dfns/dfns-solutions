import { lenderApi } from './dfns.js'
import { config } from './config.js'

// Chainlink aggregator reads, through Dfns's read-only contract-call
// passthrough (same approach as bond-issuance's readContract): no RPC node.
const LATEST_ANSWER_ABI = {
    type: 'function', name: 'latestAnswer', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'int256' }],
}
const CHAINLINK_DECIMALS = 8
const LIVE_CACHE_MS = 30_000

const state = {
    live: null as number | null,
    liveAt: 0,
    liveError: null as string | null,
    // Multiplier applied on top of the live price by the "price shock" slider
    shock: 1,
}

async function fetchLive() {
    if (state.live !== null && Date.now() - state.liveAt < LIVE_CACHE_MS) return state.live
    try {
        const result = await lenderApi.networks.callFunction({
            network: config.network,
            body: { contract: config.chainlinkFeed, abi: LATEST_ANSWER_ABI, calldata: {} },
        })
        const raw = Array.isArray(result) ? result[0] : result
        const price = Number(BigInt(raw)) / 10 ** CHAINLINK_DECIMALS
        if (!(price > 0)) throw new Error(`Unexpected feed answer: ${JSON.stringify(result)}`)
        state.live = price
        state.liveAt = Date.now()
        state.liveError = null
    } catch (e: any) {
        // Keep the last good price; the UI shows the error
        state.liveError = e.message
    }
    return state.live
}

export interface PriceQuote {
    price: number
    live: number | null
    shock: number
    source: string
    error: string | null
}

export async function getPrice(): Promise<PriceQuote> {
    const source = config.priceSource
    if (source === 'manual') {
        return { price: config.manualPriceUsd, live: state.live, shock: 1, source, error: null }
    }
    const live = await fetchLive()
    // Without a live price yet, fall back to the manual price so the demo still runs
    const base = live ?? config.manualPriceUsd
    const shock = source === 'chainlink+shock' ? state.shock : 1
    return { price: base * shock, live, shock, source, error: state.liveError }
}

export function setOverride({ shock, manualPriceUsd }: { shock?: number; manualPriceUsd?: number }) {
    if (shock !== undefined) {
        if (!(shock > 0 && shock <= 3)) throw new Error('shock must be in (0, 3]')
        state.shock = shock
    }
    if (manualPriceUsd !== undefined) {
        if (!(manualPriceUsd > 0)) throw new Error('manualPriceUsd must be > 0')
        config.manualPriceUsd = manualPriceUsd
    }
}
