import http from 'http'
import express from 'express'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { encodeDeployData, encodeFunctionData, parseUnits, formatUnits } from 'viem'
import { dfnsApi, ISSUER_WALLET_ID, INVESTOR_WALLET_ID, client } from './dfns.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json())

// State
let stableCoinAddr: string | null = null
let bondAddr: string | null = null

function loadArtifact(name: string) {
    const p = path.join(__dirname, `../artifacts/contracts/${name}.sol/${name}.json`)
    if (!fs.existsSync(p)) throw new Error(`Artifact not found: ${p}. Run 'npm run compile' first.`)
    return JSON.parse(fs.readFileSync(p, 'utf8'))
}

async function waitForTx(walletId: string, txId: string): Promise<string> {
    for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 2000))
        const tx = await dfnsApi.wallets.getTransaction({ walletId, transactionId: txId })
        if ((tx as any).txHash) return (tx as any).txHash
        if ((tx as any).status === 'Failed' || (tx as any).status === 'Rejected') {
            throw new Error(`Transaction ${(tx as any).status}: ${(tx as any).reason || txId}`)
        }
    }
    throw new Error('Transaction timed out waiting for approval')
}

async function broadcast(walletId: string, to: string | undefined, data: string) {
    const result = await dfnsApi.wallets.broadcastTransaction({
        walletId,
        body: { kind: 'Evm', to, data } as any,
    })
    let txHash = result.txHash
    if (!txHash) {
        console.log(`  Tx pending approval (${result.id}), polling...`)
        txHash = await waitForTx(walletId, result.id)
    }
    const receipt = await client.waitForTransactionReceipt({ hash: txHash as `0x${string}` })
    return { txHash, blockNumber: Number(receipt.blockNumber), contractAddress: receipt.contractAddress }
}

// ── Routes ──────────────────────────────────────────────────────────

app.get('/api/wallets', async (_req, res) => {
    try {
        const issuer = await dfnsApi.wallets.getWallet({ walletId: ISSUER_WALLET_ID })
        const investor = await dfnsApi.wallets.getWallet({ walletId: INVESTOR_WALLET_ID })
        res.json({
            issuer: { address: issuer.address, walletId: ISSUER_WALLET_ID },
            investor: { address: investor.address, walletId: INVESTOR_WALLET_ID },
        })
    } catch (e: any) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/stablecoin', async (req, res) => {
    try {
        const { name = 'Euro Coin', symbol = 'EURC' } = req.body
        const art = loadArtifact('StableCoin')
        const issuer = await dfnsApi.wallets.getWallet({ walletId: ISSUER_WALLET_ID })
        const data = encodeDeployData({ abi: art.abi, bytecode: art.bytecode, args: [issuer.address, name, symbol] })
        const result = await broadcast(ISSUER_WALLET_ID, undefined, data)
        stableCoinAddr = result.contractAddress!
        res.json({ ...result, address: stableCoinAddr })
    } catch (e: any) { res.status(500).json({ error: e.message }) }
})

app.post('/api/mint', async (req, res) => {
    try {
        const { to, amount } = req.body
        const art = loadArtifact('StableCoin')
        const data = encodeFunctionData({ abi: art.abi, functionName: 'mint', args: [to, parseUnits(amount, 6)] })
        const result = await broadcast(ISSUER_WALLET_ID, stableCoinAddr!, data)
        res.json(result)
    } catch (e: any) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/bond', async (req, res) => {
    try {
        const { name = 'Demo Bond', symbol = 'DB1', notional = '100', apr = '400', frequency = '300', duration = '3600', cap = '100000' } = req.body
        const art = loadArtifact('Bond')
        const block = await client.getBlock()
        const maturityDate = block.timestamp + BigInt(duration)
        const data = encodeDeployData({
            abi: art.abi, bytecode: art.bytecode,
            args: [name, symbol, stableCoinAddr, parseUnits(notional, 6), BigInt(apr), BigInt(frequency), maturityDate, parseUnits(cap, 6)],
        })
        const result = await broadcast(ISSUER_WALLET_ID, undefined, data)
        bondAddr = result.contractAddress!
        res.json({ ...result, address: bondAddr })
    } catch (e: any) { res.status(500).json({ error: e.message }) }
})

app.post('/api/investor/subscribe', async (req, res) => {
    try {
        const { amount } = req.body
        const parsed = parseUnits(amount, 6)
        const stableArt = loadArtifact('StableCoin')
        const bondArt = loadArtifact('Bond')
        // Approve
        const approveData = encodeFunctionData({ abi: stableArt.abi, functionName: 'approve', args: [bondAddr, parsed] })
        await broadcast(INVESTOR_WALLET_ID, stableCoinAddr!, approveData)
        // Subscribe
        const subData = encodeFunctionData({ abi: bondArt.abi, functionName: 'subscribe', args: [parsed] })
        const result = await broadcast(INVESTOR_WALLET_ID, bondAddr!, subData)
        res.json(result)
    } catch (e: any) { res.status(500).json({ error: e.message }) }
})

app.post('/api/issuer/close', async (_req, res) => {
    try {
        const art = loadArtifact('Bond')
        const data = encodeFunctionData({ abi: art.abi, functionName: 'closePrimaryIssuance' })
        res.json(await broadcast(ISSUER_WALLET_ID, bondAddr!, data))
    } catch (e: any) { res.status(500).json({ error: e.message }) }
})

app.post('/api/issuer/withdraw', async (_req, res) => {
    try {
        const art = loadArtifact('Bond')
        const data = encodeFunctionData({ abi: art.abi, functionName: 'withdrawProceeds' })
        res.json(await broadcast(ISSUER_WALLET_ID, bondAddr!, data))
    } catch (e: any) { res.status(500).json({ error: e.message }) }
})

app.post('/api/investor/claim-bond', async (_req, res) => {
    try {
        const art = loadArtifact('Bond')
        const data = encodeFunctionData({ abi: art.abi, functionName: 'claimBond' })
        res.json(await broadcast(INVESTOR_WALLET_ID, bondAddr!, data))
    } catch (e: any) { res.status(500).json({ error: e.message }) }
})

app.post('/api/issuer/deposit-coupon', async (_req, res) => {
    try {
        const bondArt = loadArtifact('Bond')
        const stableArt = loadArtifact('StableCoin')
        const couponAmount = await client.readContract({ address: bondAddr as `0x${string}`, abi: bondArt.abi, functionName: 'getCouponAmount' }) as bigint
        // Approve
        const approveData = encodeFunctionData({ abi: stableArt.abi, functionName: 'approve', args: [bondAddr, couponAmount] })
        await broadcast(ISSUER_WALLET_ID, stableCoinAddr!, approveData)
        // Deposit
        const depositData = encodeFunctionData({ abi: bondArt.abi, functionName: 'depositCoupon' })
        const result = await broadcast(ISSUER_WALLET_ID, bondAddr!, depositData)
        res.json({ ...result, couponAmount: formatUnits(couponAmount, 6) })
    } catch (e: any) { res.status(500).json({ error: e.message }) }
})

app.post('/api/investor/claim-coupon', async (req, res) => {
    try {
        const { couponIndex } = req.body
        const art = loadArtifact('Bond')
        const data = encodeFunctionData({ abi: art.abi, functionName: 'claimCoupon', args: [BigInt(couponIndex)] })
        res.json(await broadcast(INVESTOR_WALLET_ID, bondAddr!, data))
    } catch (e: any) { res.status(500).json({ error: e.message }) }
})

app.post('/api/issuer/return-principal', async (req, res) => {
    try {
        const { amount } = req.body
        const parsed = parseUnits(amount, 6)
        const bondArt = loadArtifact('Bond')
        const stableArt = loadArtifact('StableCoin')
        const approveData = encodeFunctionData({ abi: stableArt.abi, functionName: 'approve', args: [bondAddr, parsed] })
        await broadcast(ISSUER_WALLET_ID, stableCoinAddr!, approveData)
        const returnData = encodeFunctionData({ abi: bondArt.abi, functionName: 'returnPrincipal', args: [parsed] })
        res.json(await broadcast(ISSUER_WALLET_ID, bondAddr!, returnData))
    } catch (e: any) { res.status(500).json({ error: e.message }) }
})

app.post('/api/investor/redeem', async (_req, res) => {
    try {
        const art = loadArtifact('Bond')
        const data = encodeFunctionData({ abi: art.abi, functionName: 'redeem' })
        res.json(await broadcast(INVESTOR_WALLET_ID, bondAddr!, data))
    } catch (e: any) { res.status(500).json({ error: e.message }) }
})

app.get('/api/status', async (_req, res) => {
    try {
        if (!bondAddr) return res.json({ deployed: false })
        const bondArt = loadArtifact('Bond')
        const stableArt = loadArtifact('StableCoin')
        const addr = bondAddr as `0x${string}`
        const investor = await dfnsApi.wallets.getWallet({ walletId: INVESTOR_WALLET_ID })
        const issuer = await dfnsApi.wallets.getWallet({ walletId: ISSUER_WALLET_ID })

        const read = (fn: string, args: any[] = []) => client.readContract({ address: addr, abi: bondArt.abi, functionName: fn, args })
        const readStable = (fn: string, args: any[] = []) => client.readContract({ address: stableCoinAddr as `0x${string}`, abi: stableArt.abi, functionName: fn, args })

        const [issuanceClosed, isDefaulted, totalSubscribed, totalBondsIssued, totalBondsRedeemed,
               issuanceDate, maturityDate, timeToNextCoupon, couponAmount, nextCoupon,
               investorBondBalance, investorStableBalance, issuerStableBalance, accruedInterest] = await Promise.all([
            read('issuanceClosed'),
            read('isDefaulted'),
            read('totalSubscribed').then(v => formatUnits(v as bigint, 6)),
            read('totalBondsIssued'),
            read('totalBondsRedeemed'),
            read('issuanceDate').then(v => Number(v)),
            read('maturityDate').then(v => Number(v)),
            read('timeToNextCoupon').then(v => Number(v)),
            read('getCouponAmount').then(v => formatUnits(v as bigint, 6)),
            read('getNextUnfundedCoupon').then(v => Number(v)),
            read('balanceOf', [investor.address]).then(v => Number(v)),
            readStable('balanceOf', [investor.address]).then(v => formatUnits(v as bigint, 6)),
            readStable('balanceOf', [issuer.address]).then(v => formatUnits(v as bigint, 6)),
            read('accruedInterest', [investor.address]).then(v => formatUnits(v as bigint, 6)),
        ])

        res.json({
            deployed: true, bondAddr, stableCoinAddr,
            issuanceClosed, isDefaulted, totalSubscribed,
            totalBondsIssued: Number(totalBondsIssued), totalBondsRedeemed: Number(totalBondsRedeemed),
            issuanceDate, maturityDate, timeToNextCoupon, couponAmount, nextCoupon,
            investorBondBalance, investorStableBalance, issuerStableBalance, accruedInterest,
            now: Math.floor(Date.now() / 1000),
        })
    } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// Serve UI
app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'ui.html'))
})

process.on('uncaughtException', (err) => { console.error('Uncaught:', err); })
process.on('unhandledRejection', (err) => { console.error('Unhandled:', err); })

const server = http.createServer(app)
const PORT = 3000
server.listen(PORT, () => {
    console.log(`\n  Bond Issuance UI → http://localhost:${PORT}\n`)
})
server.on('error', (err) => { console.error('Server error:', err); })
