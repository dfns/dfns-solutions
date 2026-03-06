import { PublicKey, Transaction } from '@solana/web3.js'
import { dfnsApi, BANK_WALLET_ID, PROGRAM_ID } from './DfnsClient.js'
import { broadcast, u64LE } from './broadcast.js'

export async function setFXRate(paymentId: number, sender: string, amountOut: number) {
  const programId = new PublicKey(PROGRAM_ID)
  const senderPubkey = new PublicKey(sender)
  const [paymentPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('payment'), senderPubkey.toBuffer(), u64LE(paymentId)],
    programId,
  )

  console.log(`Setting FX rate for Payment PDA: ${paymentPda.toBase58()}`)

  // Anchor discriminator for "set_fx_rate"
  const discriminator = Buffer.from([219, 250, 185, 143, 241, 119, 207, 65])
  const data = Buffer.concat([
    discriminator,
    u64LE(paymentId),
    u64LE(amountOut),
  ])

  const wallet = await dfnsApi.wallets.getWallet({ walletId: BANK_WALLET_ID })

  const instruction = {
    keys: [
      { pubkey: paymentPda, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(wallet.address!), isSigner: true, isWritable: false },
    ],
    programId,
    data,
  }

  const transaction = new Transaction().add(instruction)
  return await broadcast(transaction, BANK_WALLET_ID)
}

if (process.argv[1]?.endsWith('set-fx-rate.ts')) {
  const id = parseInt(process.argv[2] || '0')
  const sender = process.argv[3]
  const amountOut = parseInt(process.argv[4] || '0')

  if (!sender || !amountOut) {
    console.error('Usage: npx tsx dfns/set-fx-rate.ts <payment_id> <sender_address> <amount_out>')
    process.exit(1)
  }

  setFXRate(id, sender, amountOut).catch(console.error)
}
