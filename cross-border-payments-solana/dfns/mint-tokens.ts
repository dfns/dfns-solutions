import { Connection, PublicKey, Transaction, clusterApiUrl } from '@solana/web3.js'
import {
  createMintToInstruction,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token'
import { dfnsApi, BANK_WALLET_ID } from './DfnsClient.js'
import { broadcast } from './broadcast.js'

async function main() {
  const mintAddress = process.argv[2]
  const recipientAddress = process.argv[3]
  const amount = process.argv[4]

  if (!mintAddress || !recipientAddress || !amount) {
    console.error('Usage: npx tsx dfns/mint-tokens.ts <mint_address> <recipient_address> <amount>')
    console.error('Amount is in base units (6 decimals). 1000000 = 1 token.')
    process.exit(1)
  }

  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed')
  const wallet = await dfnsApi.wallets.getWallet({ walletId: BANK_WALLET_ID })
  const payerPublicKey = new PublicKey(wallet.address!)
  const mintPublicKey = new PublicKey(mintAddress)
  const recipientPublicKey = new PublicKey(recipientAddress)

  const recipientATA = await getAssociatedTokenAddress(mintPublicKey, recipientPublicKey)
  const transaction = new Transaction()

  const accountInfo = await connection.getAccountInfo(recipientATA)
  if (!accountInfo) {
    console.log(`Creating ATA for recipient: ${recipientATA.toBase58()}`)
    transaction.add(
      createAssociatedTokenAccountInstruction(payerPublicKey, recipientATA, recipientPublicKey, mintPublicKey),
    )
  }

  transaction.add(createMintToInstruction(mintPublicKey, recipientATA, payerPublicKey, BigInt(amount)))

  console.log(`Minting ${amount} tokens to ${recipientAddress}...`)
  await broadcast(transaction, BANK_WALLET_ID)
}

main().catch(console.error)
