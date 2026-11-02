// Signer simulator: sends the Validation Gate the same requests a Dfns signer
// would (same JSON, same HMAC headers), so the gate can be exercised with a
// plain SaaS org, where the signer isn't ours to configure. A real signer
// behind --validation-gate-url hits the same handler unchanged.
import crypto from 'crypto'
import { requireEnv, env } from '../src/env.js'
import { CONTENT_TYPE, SIGNATURE_HEADER, SIGNATURE_TYPE, SIGNATURE_TYPE_HEADER, STATUS, serialize, parseSecret, sign, type ValidationGateReq } from '../gate/protocol.js'
import { loadConfig, withinHours } from '../gate/rules.js'

requireEnv('GATE_SHARED_SECRET', 'GATE_MAX_AMOUNT_WEI', 'GATE_ALLOWLIST')

const url = env('GATE_URL') || `http://localhost:${env('GATE_PORT') || 4000}/validate`
const secret = parseSecret(env('GATE_SHARED_SECRET'))
const config = loadConfig(env)
const allowed = [...config.allowlist][0]
// Not on any sensible allowlist
const stranger = '0x000000000000000000000000000000000000dEaD'
const small = config.maxAmountWei < 1_000_000_000_000_000n ? config.maxAmountWei : 1_000_000_000_000_000n // ≤ 0.001 ETH

// A Sepolia native transfer from the custody vault, as the signer sees it
function transfer(to: string, amount: bigint): ValidationGateReq {
    return {
        signerInfo: {
            txHash: '0x' + crypto.randomBytes(32).toString('hex'),
            keyId: 'key-custody-demo',
            kind: 'Signing',
            publicKey: '02' + crypto.randomBytes(32).toString('hex'),
        },
        path: '/vaults/vlt-custody-demo/transfers',
        payload: { kind: 'Native', to, amount: amount.toString() },
        userId: 'us-custody-backend',
        sourceAddress: '0x1111111111111111111111111111111111111111',
        destinationAddress: to,
    }
}

const inHours = withinHours(config.hours, config.timeZone, new Date())
const ok = inHours ? STATUS.approved : STATUS.rejected

type Scenario = { name: string; req: ValidationGateReq; expect: number; secret?: Buffer }
const scenarios: Scenario[] = [
    { name: 'allowed transfer', req: transfer(allowed, small), expect: ok },
    { name: 'over the cap', req: transfer(allowed, config.maxAmountWei + 1n), expect: STATUS.rejected },
    { name: 'destination not allowlisted', req: transfer(stranger, small), expect: STATUS.rejected },
    // Signed with a secret the gate doesn't know: an impostor, not the signer
    { name: 'bad signature', req: transfer(allowed, small), expect: STATUS.badSignature, secret: crypto.randomBytes(32) },
    {
        name: 'key export',
        req: { signerInfo: { keyId: 'key-custody-demo', kind: 'KeyExport', publicKey: '02' + crypto.randomBytes(32).toString('hex') } },
        expect: config.allowKeyExport ? ok : STATUS.rejected,
    },
    {
        // A raw signature request: the signer has a hash but no intent
        name: 'no intent',
        req: { signerInfo: { txHash: '0x' + crypto.randomBytes(32).toString('hex'), keyId: 'key-custody-demo', kind: 'Signing', publicKey: '02' + crypto.randomBytes(32).toString('hex') } },
        expect: config.allowNoIntent ? ok : STATUS.rejected,
    },
]

async function send(s: Scenario) {
    const body = serialize(s.req)
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': CONTENT_TYPE,
            [SIGNATURE_TYPE_HEADER]: SIGNATURE_TYPE,
            [SIGNATURE_HEADER]: sign(s.secret ?? secret, body),
        },
        body,
    })
    const reply = await res.json().catch(() => ({})) as { reason?: string }
    return { status: res.status, reason: reply.reason ?? '' }
}

async function main() {
    console.log(`Simulating a signer against ${url}`)
    if (!inHours) console.log('(outside GATE_HOURS right now: allowed requests are expected to be rejected)')
    console.log()
    let failures = 0
    for (const s of scenarios) {
        const { status, reason } = await send(s)
        // What the signer would do with this answer
        const outcome = status === STATUS.approved ? 'signs' : status === STATUS.malformed || status === STATUS.badSignature ? 'refuses (Unauthenticated)' : 'refuses (PermissionDenied)'
        const pass = status === s.expect
        if (!pass) failures++
        console.log(`${pass ? '✓' : '✗'} ${s.name.padEnd(28)} ${status} → signer ${outcome}${pass ? '' : ` (expected ${s.expect})`}`)
        console.log(`  ${reason}`)
    }
    console.log(`\n${scenarios.length - failures} of ${scenarios.length} as expected`)
    if (failures) process.exit(1)
}

main().catch(e => {
    console.error(e instanceof TypeError && String(e.cause).includes('ECONNREFUSED') ? `Gate not reachable at ${url}: run 'npm run gate' first` : e)
    process.exit(1)
})
