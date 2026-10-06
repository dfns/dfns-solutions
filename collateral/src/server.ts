import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import express, { type Request, type Response, type NextFunction } from 'express'
import { isAddress, parseEther, parseUnits } from 'viem'
import { requireEnv, env } from './env.js'
import { errorDetail } from './dfns.js'
import { config, updateConfig } from './config.js'
import { subscribe, recentTimeline } from './events.js'
import { getPrice, setOverride } from './price.js'
import { allLoans } from './store.js'
import { getVaultState, releaseQuarantine, withdrawFromVault } from './vault.js'
import { requestLoan, approveLoan, rejectLoan, topUpLoan, acceptTopUp, repayLoan, liquidateLoan, viewLoan } from './loans.js'
import { startRiskEngine } from './risk.js'

requireEnv(
    'DFNS_ORG_ID', 'DFNS_AUTH_TOKEN', 'DFNS_CRED_ID', 'DFNS_PRIVATE_KEY',
    'BORROWER_VAULT_ID', 'LENDER_VAULT_ID',
)
if (!config.loanAsset.contract) throw new Error('Set PYUSD_CONTRACT in .env')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, '../public')))

type Handler = (req: Request, res: Response) => Promise<unknown>
const route = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).then(r => res.json(r ?? { ok: true })).catch(next)

function eth(value: unknown) {
    if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value)) throw Object.assign(new Error('Amount must be a decimal string, e.g. "0.05"'), { status: 400 })
    return parseEther(value)
}

function pyusd(value: unknown) {
    if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value)) throw Object.assign(new Error('Amount must be a decimal string, e.g. "100"'), { status: 400 })
    return parseUnits(value, config.loanAsset.decimals)
}

// Dfns reads for the dashboard, cached briefly so several open tabs don't
// multiply API traffic
let snapshot: { at: number; data: any } | null = null

async function dfnsSnapshot() {
    if (snapshot && Date.now() - snapshot.at < 3000) return snapshot.data
    const [borrower, lender] = await Promise.all([getVaultState('borrower'), getVaultState('lender')])
    const data = { vaults: { borrower, lender } }
    snapshot = { at: Date.now(), data }
    return data
}

function invalidate() {
    snapshot = null
}

// ── Shared ──────────────────────────────────────────────────────────

app.get('/api/state', route(async () => {
    // Still return loans and config if Dfns can't be reached, so the UI can say why
    const [dfns, price] = await Promise.all([
        dfnsSnapshot().catch(e => ({ vaults: null, dfnsError: errorDetail(e).message })),
        getPrice(),
    ])
    return {
        ...dfns,
        price,
        config,
        loans: allLoans().map(l => viewLoan(l, price.price)),
        timeline: recentTimeline(),
    }
}))

app.get('/api/events', (_req, res) => subscribe(res))

// ── Borrower ────────────────────────────────────────────────────────

// Deposits are plain on-chain sends to the vault address from outside the
// demo, so the borrower's first step is accepting them out of quarantine
app.post('/api/:party/quarantines/:id/release', route(async req => {
    const party = req.params.party
    if (party !== 'borrower' && party !== 'lender') throw Object.assign(new Error('Unknown party'), { status: 404 })
    const result = await releaseQuarantine(party, String(req.params.id))
    invalidate()
    return result
}))

app.post('/api/borrower/loans', route(async req => {
    const loan = await requestLoan(eth(req.body.collateralEth), pyusd(req.body.principal))
    invalidate()
    return loan
}))

app.post('/api/borrower/loans/:id/topup', route(async req => {
    const loan = await topUpLoan(String(req.params.id), eth(req.body.amountEth))
    invalidate()
    return loan
}))

app.post('/api/borrower/loans/:id/repay', route(async req => {
    const amount = req.body.full ? 'full' as const : pyusd(req.body.amount)
    const loan = await repayLoan(String(req.params.id), amount)
    invalidate()
    return loan
}))

app.post('/api/borrower/withdraw', route(async req => {
    const to = req.body.to
    if (!isAddress(to, { strict: false })) throw Object.assign(new Error('Destination must be an 0x address'), { status: 400 })
    const result = await withdrawFromVault(eth(req.body.amountEth), to)
    invalidate()
    return { transferId: result.id, txHash: result.txHash }
}))

// ── Lender ──────────────────────────────────────────────────────────

app.post('/api/lender/loans/:id/approve', route(async req => {
    const loan = await approveLoan(String(req.params.id))
    invalidate()
    return loan
}))

app.post('/api/lender/loans/:id/reject', route(req => rejectLoan(String(req.params.id))))

app.post('/api/lender/loans/:id/accept-topup', route(async req => {
    const loan = await acceptTopUp(String(req.params.id))
    invalidate()
    return loan
}))

app.post('/api/lender/loans/:id/liquidate', route(async req => {
    const loan = await liquidateLoan(String(req.params.id), 'lender', 'Manual liquidation by the lender')
    invalidate()
    return loan
}))

app.put('/api/config', route(async req => updateConfig(req.body ?? {})))

app.put('/api/price/override', route(async req => {
    setOverride({ shock: req.body.shock, manualPriceUsd: req.body.manualPriceUsd })
    return getPrice()
}))

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const detail = errorDetail(err)
    const status = err.status ?? (detail as any).httpStatus ?? 500
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: detail.message, context: (detail as any).context })
})

process.on('unhandledRejection', err => { console.error('Unhandled:', err) })

const PORT = Number(env('PORT') || 3000)
http.createServer(app).listen(PORT, () => {
    console.log(`\n  Collateral Lending UI → http://localhost:${PORT}\n`)
    startRiskEngine()
})
