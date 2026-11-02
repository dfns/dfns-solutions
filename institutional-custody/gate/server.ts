// Validation Gate handler: the institution's endpoint that a Dfns signer calls
// before every signature (configured with --validation-gate-url). It answers
// 200 to let the key sign, anything else to stop it. See protocol.ts for the
// wire format and rules.ts for the decisions.
import http from 'http'
import { requireEnv, env } from '../src/env.js'
import { CONTENT_TYPE, SIGNATURE_HEADER, SIGNATURE_TYPE, SIGNATURE_TYPE_HEADER, STATUS, parse, parseSecret, verify, type ValidationGateReq } from './protocol.js'
import { decide, loadConfig } from './rules.js'

requireEnv('GATE_SHARED_SECRET', 'GATE_MAX_AMOUNT_WEI')

const PATH = '/validate'
const port = Number(env('GATE_PORT') || 4000)
const secret = parseSecret(env('GATE_SHARED_SECRET'))
const config = loadConfig(env)

// The rules as the gate is actually running them, for display
function publicRules() {
    return {
        maxAmountWei: config.maxAmountWei.toString(),
        allowlist: [...config.allowlist],
        hours: env('GATE_HOURS') || null,
        timeZone: config.timeZone,
        allowKeyExport: config.allowKeyExport,
        allowNoIntent: config.allowNoIntent,
    }
}

function reply(res: http.ServerResponse, status: number, body: object) {
    res.writeHead(status, { 'Content-Type': CONTENT_TYPE })
    res.end(JSON.stringify(body))
}

// Recent decisions, newest first, for the walkthrough page (GET /decisions).
// What was asked and why it was answered so: never the secret or signatures.
type GateDecision = { at: string; status: number; approved: boolean; reason: string; kind?: string; keyId?: string; amount?: string; to?: string; path?: string }
const MAX_DECISIONS = 50
const decisions: GateDecision[] = []

// One line per request: what was decided and why
function log(status: number, reason: string, req?: ValidationGateReq) {
    const verdict = status === STATUS.approved ? 'APPROVED' : 'REJECTED'
    const keyId = req?.signerInfo.keyId
    const at = new Date().toISOString()
    console.log(`${at} ${verdict} ${status}${keyId ? ` ${keyId}` : ''}: ${reason}`)
    decisions.unshift({
        at, status, approved: status === STATUS.approved, reason, keyId,
        kind: req?.signerInfo.kind, amount: req?.payload?.amount, to: req?.payload?.to ?? req?.destinationAddress, path: req?.path,
    })
    decisions.length = Math.min(decisions.length, MAX_DECISIONS)
}

const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/decisions') {
        return reply(res, 200, { rules: publicRules(), decisions })
    }
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
        log(status, decision.reason, parsed)
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
