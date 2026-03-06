import { Connection, PublicKey, Transaction, clusterApiUrl } from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token'
import { dfnsApi, BANK_WALLET_ID, SOURCE_MINT, TARGET_MINT, PROGRAM_ID } from './DfnsClient.js'
import { broadcast, u64LE } from './broadcast.js'

export async function executePayment(paymentId: number) {
  const programId = new PublicKey(PROGRAM_ID)
  const sourceMint = new PublicKey(SOURCE_MINT)
  const targetMint = new PublicKey(TARGET_MINT)
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed')
  const wallet = await dfnsApi.wallets.getWallet({ walletId: BANK_WALLET_ID })
  if (!wallet.address) throw new Error('Bank wallet address not found')
  const sender = new PublicKey(wallet.address)

  const [paymentPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('payment'), sender.toBuffer(), u64LE(paymentId)],
    programId,
  )

  // Fetch payment PDA to get the receiver
  const paymentAccount = await connection.getAccountInfo(paymentPda)
  if (!paymentAccount) throw new Error(`Payment PDA ${paymentPda.toBase58()} not found. Initialize it first.`)

  // Offset 48: discriminator(8) + id(8) + sender(32) -> receiver(32)
  const receiverPubkey = new PublicKey(paymentAccount.data.slice(48, 80))
  console.log(`Receiver: ${receiverPubkey.toBase58()}`)

  // Find sender's source token account
  const senderSourceAta = await getAssociatedTokenAddress(sourceMint, sender)
  let bestSenderAccount = senderSourceAta

  const senderAtaInfo = await connection.getAccountInfo(senderSourceAta)
  if (!senderAtaInfo) {
    const otherAccounts = await connection.getParsedTokenAccountsByOwner(sender, { mint: sourceMint })
    if (otherAccounts.value.length > 0 && otherAccounts.value[0]) {
      bestSenderAccount = otherAccounts.value[0].pubkey
      console.log(`Using existing sender token account: ${bestSenderAccount.toBase58()}`)
    }
  }

  // Find or create receiver's target token account
  const receiverTargetAta = await getAssociatedTokenAddress(targetMint, receiverPubkey)
  const transaction = new Transaction()

  const receiverInfo = await connection.getAccountInfo(receiverTargetAta)
  if (!receiverInfo) {
    console.log(`Creating receiver ATA: ${receiverTargetAta.toBase58()}`)
    transaction.add(
      createAssociatedTokenAccountInstruction(sender, receiverTargetAta, receiverPubkey, targetMint),
    )
  }

  console.log(`Executing Payment PDA: ${paymentPda.toBase58()}`)

  // Anchor discriminator for "execute_payment"
  const discriminator = Buffer.from([86, 4, 7, 7, 120, 139, 232, 139])
  const data = Buffer.concat([discriminator, u64LE(paymentId)])

  const instruction = {
    keys: [
      { pubkey: paymentPda, isSigner: false, isWritable: true },
      { pubkey: sender, isSigner: true, isWritable: true },
      { pubkey: sourceMint, isSigner: false, isWritable: true },
      { pubkey: bestSenderAccount, isSigner: false, isWritable: true },
      { pubkey: targetMint, isSigner: false, isWritable: true },
      { pubkey: receiverTargetAta, isSigner: false, isWritable: true },
      { pubkey: sender, isSigner: false, isWritable: false }, // Mint authority
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  }

  transaction.add(instruction)
  return await broadcast(transaction, BANK_WALLET_ID)
}

if (process.argv[1]?.endsWith('execute-payment.ts')) {
  const id = parseInt(process.argv[2] || '0')
  if (isNaN(id)) {
    console.error('Usage: npx tsx dfns/execute-payment.ts <payment_id>')
    process.exit(1)
  }
  executePayment(id).catch(console.error)
}
