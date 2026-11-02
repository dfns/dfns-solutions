// Validation Gate handler: the institution's endpoint that a Dfns signer calls
// before every signature (configured with --validation-gate-url). It answers
// 200 to let the key sign, anything else to stop it. See protocol.ts for the
// wire format and rules.ts for the decisions.
import http from 'http'
import { requireEnv, env } from '../src/env.js'
import { CONTENT_TYPE, SIGNATURE_HEADER, SIGNATURE_TYPE, SIGNATURE_TYPE_HEADER, STATUS, parse, parseSecret, verify } from './protocol.js'
import { decide, loadConfig } from './rules.js'

requireEnv('GATE_SHARED_SECRET', 'GATE_MAX_AMOUNT_WEI')

const PATH = '/validate'
const port = Number(env('GATE_PORT') || 4000)
const secret = parseSecret(env('GATE_SHARED_SECRET'))
const config = loadConfig(env)

function reply(res: http.ServerResponse, status: number, body: object) {
    res.writeHead(status, { 'Content-Type': CONTENT_TYPE })
    res.end(JSON.stringify(body))
}

// One line per request: what was decided and why
function log(status: number, reason: string, keyId?: string) {
    const verdict = status === STATUS.approved ? 'APPROVED' : 'REJECTED'
    console.log(`${new Date().toISOString()} ${verdict} ${status}${keyId ? ` ${keyId}` : ''}: ${reason}`)
}

const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== PATH) {
        return reply(res, 404, { error: `POST ${PATH} only` })
    }
    // Keep the raw bytes: the HMAC covers the body exactly as sent, so it
    // must be checked before (and independently of) JSON parsing
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
        const body = Buffer.concat(chunks)
        const signature = req.headers[SIGNATURE_HEADER]
        if (req.headers[SIGNATURE_TYPE_HEADER] !== SIGNATURE_TYPE || !verify(secret, body, typeof signature === 'string' ? signature : undefined)) {
            const reason = signature ? 'bad signature' : 'missing signature'
            log(STATUS.badSignature, reason)
            return reply(res, STATUS.badSignature, { approved: false, reason })
        }
        const parsed = parse(body)
        if (typeof parsed === 'string') {
            log(STATUS.malformed, parsed)
            return reply(res, STATUS.malformed, { approved: false, reason: parsed })
        }
        const decision = decide(parsed, config)
        const status = decision.approved ? STATUS.approved : STATUS.rejected
        log(status, decision.reason, parsed.signerInfo.keyId)
        reply(res, status, decision)
    })
})

server.listen(port, () => {
    console.log(`Validation Gate on http://localhost:${port}${PATH}`)
    console.log(`  cap        ${config.maxAmountWei} wei`)
    console.log(`  allowlist  ${[...config.allowlist].join(', ') || '(empty: every destination is rejected)'}`)
    console.log(`  hours      ${env('GATE_HOURS') ? `${env('GATE_HOURS')} ${config.timeZone}` : 'any time'}`)
    console.log(`  key export ${config.allowKeyExport ? 'allowed' : 'rejected'}, no intent ${config.allowNoIntent ? 'allowed' : 'rejected'}\n`)
})
