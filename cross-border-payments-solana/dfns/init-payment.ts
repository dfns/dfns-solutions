import { PublicKey, Transaction, SystemProgram } from '@solana/web3.js'
import { dfnsApi, BANK_WALLET_ID, PROGRAM_ID } from './DfnsClient.js'
import { broadcast, u64LE } from './broadcast.js'

export async function initPayment(paymentId: number, receiver: string, amount: number) {
  const programId = new PublicKey(PROGRAM_ID)
  const wallet = await dfnsApi.wallets.getWallet({ walletId: BANK_WALLET_ID })
  const sender = new PublicKey(wallet.address!)
  const receiverPubkey = new PublicKey(receiver)

  const [paymentPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('payment'), sender.toBuffer(), u64LE(paymentId)],
    programId,
  )

  console.log(`Initializing Payment PDA: ${paymentPda.toBase58()}`)

  // Anchor discriminator for "initialize_payment"
  const discriminator = Buffer.from([10, 18, 43, 254, 174, 203, 246, 3])
  const data = Buffer.concat([
    discriminator,
    u64LE(paymentId),
    u64LE(amount),
  ])

  const instruction = {
    keys: [
      { pubkey: paymentPda, isSigner: false, isWritable: true },
      { pubkey: sender, isSigner: true, isWritable: true },
      { pubkey: receiverPubkey, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  }

  const transaction = new Transaction().add(instruction)
  return await broadcast(transaction, BANK_WALLET_ID)
}

if (process.argv[1]?.endsWith('init-payment.ts')) {
  const id = parseInt(process.argv[2] || '0')
  const receiver = process.argv[3]
  const amount = parseInt(process.argv[4] || '1000000')

  if (!receiver) {
    console.error('Usage: npx tsx dfns/init-payment.ts <payment_id> <receiver_address> <amount>')
    process.exit(1)
  }

  initPayment(id, receiver, amount).catch(console.error)
}
