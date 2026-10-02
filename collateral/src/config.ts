import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import './env.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const DEFAULTS_PATH = path.join(ROOT, 'config.json')
// Changes made from the UI are kept out of the tracked config.json
const OVERRIDES_PATH = path.join(ROOT, 'data', 'config.json')

export type PriceSource = 'chainlink' | 'manual' | 'chainlink+shock'

export interface Config {
    network: 'EthereumSepolia'
    collateralTid: string
    loanAsset: { symbol: string; contract: string; decimals: number }
    borrowerPyusdBuffer: number
    // ETH kept Available in the borrower vault and never pledged, to pay gas
    // for repayments and lock transfers
    gasReserveEth: number
    maxInitialLtv: number
    marginCallLtv: number
    targetLtv: number
    liquidationLtv: number
    liquidationPenaltyBps: number
    aprBps: number
    gracePeriodSec: number
    riskIntervalSec: number
    priceSource: PriceSource
    chainlinkFeed: string
    manualPriceUsd: number
    autoLiquidate: boolean
    autoAcceptTopUp: boolean
}

// Fields the lender can change live from the settings drawer
export const EDITABLE_KEYS = [
    'maxInitialLtv', 'marginCallLtv', 'targetLtv', 'liquidationLtv',
    'liquidationPenaltyBps', 'aprBps', 'gracePeriodSec', 'riskIntervalSec',
    'priceSource', 'autoLiquidate', 'autoAcceptTopUp', 'gasReserveEth',
] as const

function readJson(p: string) {
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {}
}

export function validateConfig(c: Config) {
    const errors: string[] = []
    if (!(c.maxInitialLtv > 0 && c.maxInitialLtv <= c.targetLtv)) errors.push('0 < maxInitialLtv ≤ targetLtv')
    if (!(c.targetLtv < c.marginCallLtv)) errors.push('targetLtv < marginCallLtv')
    if (!(c.marginCallLtv < c.liquidationLtv)) errors.push('marginCallLtv < liquidationLtv')
    if (!(c.liquidationLtv < 1)) errors.push('liquidationLtv < 1')
    if (!(c.liquidationPenaltyBps >= 0 && c.liquidationPenaltyBps <= 5000)) errors.push('0 ≤ liquidationPenaltyBps ≤ 5000')
    if (!(c.aprBps >= 0)) errors.push('aprBps ≥ 0')
    if (!(c.gracePeriodSec >= 0)) errors.push('gracePeriodSec ≥ 0')
    if (!(c.riskIntervalSec >= 1)) errors.push('riskIntervalSec ≥ 1')
    if (!(c.gasReserveEth >= 0)) errors.push('gasReserveEth ≥ 0')
    if (!['chainlink', 'manual', 'chainlink+shock'].includes(c.priceSource)) errors.push('priceSource is chainlink, manual or chainlink+shock')
    if (errors.length) throw new Error(`Invalid config: ${errors.join(', ')}`)
}

function load(): Config {
    const c = { ...readJson(DEFAULTS_PATH), ...readJson(OVERRIDES_PATH) } as Config
    if (process.env.PYUSD_CONTRACT) c.loanAsset = { ...c.loanAsset, contract: process.env.PYUSD_CONTRACT }
    validateConfig(c)
    return c
}

export let config: Config = load()

export function updateConfig(patch: Record<string, unknown>) {
    const picked: Record<string, unknown> = {}
    for (const key of EDITABLE_KEYS) {
        if (key in patch) picked[key] = patch[key]
    }
    const next = { ...config, ...picked } as Config
    validateConfig(next)
    config = next

    const overrides = { ...readJson(OVERRIDES_PATH), ...picked }
    fs.mkdirSync(path.dirname(OVERRIDES_PATH), { recursive: true })
    fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(overrides, null, 2))
    return config
}
