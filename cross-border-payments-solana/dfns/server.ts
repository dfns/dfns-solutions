import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js'
import { getAssociatedTokenAddress, AccountLayout } from '@solana/spl-token'
import { dfnsApi, BANK_WALLET_ID, SOURCE_MINT, TARGET_MINT, PROGRAM_ID } from './DfnsClient.js'
import { initPayment } from './init-payment.js'
import { setFXRate } from './set-fx-rate.js'
import { executePayment } from './execute-payment.js'
import { u64LE } from './broadcast.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json())

const connection = new Connection(clusterApiUrl('devnet'), 'confirmed')

// ── Routes ──────────────────────────────────────────────────────────

app.get('/api/config', async (_req, res) => {
  try {
    const wallet = await dfnsApi.wallets.getWallet({ walletId: BANK_WALLET_ID })
    res.json({
      bankAddress: wallet.address,
      bankWalletId: BANK_WALLET_ID,
      sourceMint: SOURCE_MINT,
      targetMint: TARGET_MINT,
      programId: PROGRAM_ID,
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/init-payment', async (req, res) => {
  try {
    const { paymentId, receiver, amount } = req.body
    const txHash = await initPayment(Number(paymentId), receiver, Number(amount))
    res.json({ txHash })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/set-fx-rate', async (req, res) => {
  try {
    const { paymentId, sender, amountOut } = req.body
    const txHash = await setFXRate(Number(paymentId), sender, Number(amountOut))
    res.json({ txHash })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/execute-payment', async (req, res) => {
  try {
    const { paymentId } = req.body
    const txHash = await executePayment(Number(paymentId))
    res.json({ txHash })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/payment/:sender/:id', async (req, res) => {
  try {
    const programId = new PublicKey(PROGRAM_ID)
    const sender = new PublicKey(req.params.sender)
    const paymentId = Number(req.params.id)

    const [paymentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('payment'), sender.toBuffer(), u64LE(paymentId)],
      programId,
    )

    const account = await connection.getAccountInfo(paymentPda)
    if (!account) return res.json({ exists: false })

    // Parse: discriminator(8) + id(8) + sender(32) + receiver(32) + amount_in(8) + amount_out(8) + status(1) + bump(1)
    const data = account.data
    const id = Number(data.readBigUInt64LE(8))
    const senderKey = new PublicKey(data.slice(16, 48))
    const receiver = new PublicKey(data.slice(48, 80))
    const amountIn = Number(data.readBigUInt64LE(80))
    const amountOut = Number(data.readBigUInt64LE(88))
    const statusByte = data[96]
    const status = statusByte === 0 ? 'PendingFX' : statusByte === 1 ? 'FXRateSet' : 'Completed'

    res.json({
      exists: true,
      pda: paymentPda.toBase58(),
      id,
      sender: senderKey.toBase58(),
      receiver: receiver.toBase58(),
      amountIn,
      amountOut,
      status,
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/balances/:address', async (req, res) => {
  try {
    const sourceMint = new PublicKey(SOURCE_MINT)
    const targetMint = new PublicKey(TARGET_MINT)
    const owner = new PublicKey(req.params.address)

    async function getTokenBalance(mint: PublicKey): Promise<number> {
      try {
        const ata = await getAssociatedTokenAddress(mint, owner)
        const info = await connection.getAccountInfo(ata)
        if (!info) return 0
        const decoded = AccountLayout.decode(info.data)
        return Number(decoded.amount)
      } catch {
        return 0
      }
    }

    const [source, target, sol] = await Promise.all([
      getTokenBalance(sourceMint),
      getTokenBalance(targetMint),
      connection.getBalance(owner),
    ])

    res.json({ source, target, sol })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// Serve UI
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'ui.html'))
})

const PORT = Number(process.env.PORT || 3000)
const server = app.listen(PORT, () => {
  console.log(`\n  Cross-Border Payments UI -> http://localhost:${PORT}\n`)
})
server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Try: PORT=3001 npm run ui\n`)
    process.exit(1)
  }
  throw err
})
