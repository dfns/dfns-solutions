// The institution's rules: the last veto before a key signs. They run after
// Dfns's own policies and approvals, on the signer's side, so they hold even
// if everything upstream were bypassed. Every rule fails closed: anything the
// gate can't check is rejected.
import type { ValidationGateReq } from './protocol.js'
import { NATIVE_ETH, display } from '../src/units.js'

// Reasons are read by people (gate log, walkthrough page): ETH, not wei
const eth = (wei: string | bigint) => display(wei.toString(), NATIVE_ETH)

export type GateConfig = {
    maxAmountWei: bigint
    allowlist: Set<string> // lowercase EVM addresses
    allowKeyExport: boolean
    allowNoIntent: boolean
    hours?: { from: number; to: number } // [from, to) in timeZone
    timeZone: string
}

export type Decision = { approved: true; reason: string } | { approved: false; reason: string }

// Reads the rules from the environment (GATE_* in .env)
export function loadConfig(env: (name: string) => string): GateConfig {
    const max = env('GATE_MAX_AMOUNT_WEI')
    if (!/^\d+$/.test(max)) throw new Error('GATE_MAX_AMOUNT_WEI must be a whole number of wei')
    return {
        maxAmountWei: BigInt(max),
        allowlist: new Set(env('GATE_ALLOWLIST').split(',').map(a => a.trim().toLowerCase()).filter(Boolean)),
        allowKeyExport: env('GATE_ALLOW_KEY_EXPORT') === 'true',
        allowNoIntent: env('GATE_ALLOW_NO_INTENT') === 'true',
        hours: parseHours(env('GATE_HOURS')),
        timeZone: env('GATE_TIMEZONE') || 'UTC',
    }
}

// "08-20" → 08:00 to 19:59. Empty means any time. "22-06" spans midnight.
export function parseHours(value: string) {
    if (!value) return undefined
    const m = /^(\d{1,2})-(\d{1,2})$/.exec(value.trim())
    if (!m || +m[1] > 23 || +m[2] > 24 || +m[1] === +m[2]) throw new Error(`GATE_HOURS must look like 08-20, got "${value}"`)
    return { from: +m[1], to: +m[2] }
}

export function withinHours(hours: GateConfig['hours'], timeZone: string, now: Date) {
    if (!hours) return true
    const hour = +new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(now)
    return hours.from < hours.to
        ? hour >= hours.from && hour < hours.to
        : hour >= hours.from || hour < hours.to
}

export function decide(req: ValidationGateReq, config: GateConfig, now = new Date()): Decision {
    const reject = (reason: string): Decision => ({ approved: false, reason })
    const { kind } = req.signerInfo

    if (kind === 'KeyExport' && !config.allowKeyExport) return reject('key export is disabled (GATE_ALLOW_KEY_EXPORT)')
    if (!withinHours(config.hours, config.timeZone, now)) {
        return reject(`outside business hours (${String(config.hours!.from).padStart(2, '0')}-${String(config.hours!.to).padStart(2, '0')} ${config.timeZone})`)
    }
    if (kind === 'KeyExport') return { approved: true, reason: 'key export allowed' }

    // Without an intent (e.g. a raw signature) the gate can't see what is
    // being signed, so it can't apply the amount and destination rules
    if (!req.payload) {
        return config.allowNoIntent
            ? { approved: true, reason: 'no intent, allowed by GATE_ALLOW_NO_INTENT' }
            : reject('no intent: the gate cannot check amount or destination (GATE_ALLOW_NO_INTENT)')
    }

    const { payload } = req
    // The cap is in wei, which only means something for native transfers
    if (payload.kind !== 'Native') return reject(`${payload.kind} transfer: only native transfers are allowed`)
    const to = payload.to.toLowerCase()
    // Both fields come from the same request; disagreeing means something is off
    if (req.destinationAddress && req.destinationAddress.toLowerCase() !== to) {
        return reject(`intent destination ${payload.to} differs from destinationAddress ${req.destinationAddress}`)
    }
    if (!config.allowlist.has(to)) return reject(`destination ${payload.to} is not on the allowlist`)
    if (!/^\d+$/.test(payload.amount)) return reject(`amount "${payload.amount}" is not a whole number`)
    if (BigInt(payload.amount) > config.maxAmountWei) {
        return reject(`amount ${eth(payload.amount)} is over the cap of ${eth(config.maxAmountWei)}`)
    }
    return { approved: true, reason: `${eth(payload.amount)} to allowlisted ${payload.to}` }
}
