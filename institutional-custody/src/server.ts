import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import express, { type Request, type Response, type NextFunction } from 'express'
import { requireEnv, env } from './env.js'
import { errorDetail } from './dfns.js'
import { recentTimeline } from './events.js'
import { state, startPoller } from './poller.js'
import { withdraw, releaseQuarantine, auditCsv } from './custody.js'
import { parseUnits } from './units.js'
import { controls, gateDecisions, approval } from './overview.js'

requireEnv('DFNS_ORG_ID', 'DFNS_AUTH_TOKEN', 'DFNS_CRED_ID', 'DFNS_PRIVATE_KEY', 'VAULT_ID')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json())
// The walkthrough page: plain HTML, CSS and JS, no build step
app.use(express.static(path.join(__dirname, '../public')))

type Handler = (req: Request, res: Response) => Promise<unknown>
const route = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).then(r => res.json(r ?? { ok: true })).catch(next)
const badRequest = (message: string) => Object.assign(new Error(message), { status: 400 })

app.get('/api/state', route(async () => state))

app.get('/api/timeline', route(async () => recentTimeline()))

app.get('/api/config', route(() => controls()))

app.get('/api/gate', route(() => gateDecisions()))

app.get('/api/approvals/:id', route(req => approval(String(req.params.id))))

app.post('/api/withdrawals', route(async req => {
    const { amountEth, to } = req.body ?? {}
    if (typeof to !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(to)) throw badRequest('to must be an 0x address')
    let amount: bigint
    try {
        amount = parseUnits(String(amountEth ?? ''), 18)
    } catch (e) {
        throw badRequest(`amountEth: ${(e as Error).message}`)
    }
    if (amount === 0n) throw badRequest('amountEth must be more than 0')
    const t = await withdraw(amount, to)
    return { transferId: t.id, status: t.status, approvalId: t.approvalId }
}))

app.post('/api/quarantines/:id/release', route(async req => {
    const reason = req.body?.reason
    if (typeof reason !== 'string' || !reason.trim()) throw badRequest('A reason is required: it is kept with the release request for audit')
    const r = await releaseQuarantine(String(req.params.id), reason.trim())
    return { requestId: r.id, status: r.status, approvalId: r.approvalId }
}))

app.get('/api/audit.csv', (_req, res, next) => {
    auditCsv().then(csv => {
        const day = new Date().toISOString().slice(0, 10)
        res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="vault-${env('VAULT_ID')}-${day}.csv"` })
        res.send(csv)
    }).catch(next)
})

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const detail = errorDetail(err)
    const status = err.status ?? (detail as any).httpStatus ?? 500
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: detail.message, context: (detail as any).context })
})

process.on('unhandledRejection', err => { console.error('Unhandled:', err) })

const PORT = Number(env('PORT') || 3000)
http.createServer(app).listen(PORT, () => {
    console.log(`\n  Custody walkthrough → http://localhost:${PORT}\n`)
    startPoller()
})
