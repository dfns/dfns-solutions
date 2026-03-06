import { Connection, PublicKey, Transaction, clusterApiUrl } from '@solana/web3.js'
import { dfnsApi } from './DfnsClient.js'

/** Encode a number as an 8-byte little-endian u64 Buffer. */
export function u64LE(n: number): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(BigInt(n))
  return buf
}

export async function broadcast(transaction: Transaction, walletId: string): Promise<string> {
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed')
  const wallet = await dfnsApi.wallets.getWallet({ walletId })
  if (!wallet.address) throw new Error('Wallet address not found')
  const payerPublicKey = new PublicKey(wallet.address)

  const { blockhash } = await connection.getLatestBlockhash()
  transaction.recentBlockhash = blockhash
  transaction.feePayer = payerPublicKey

  const serializedTransaction = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }).toString('hex')

  console.log(`Broadcasting transaction via Dfns (Wallet: ${walletId})...`)
  const result = await dfnsApi.wallets.broadcastTransaction({
    walletId,
    body: {
      kind: 'Transaction',
      transaction: serializedTransaction,
    } as any,
  })
  console.log('Status:', result.status)
  if (result.status === 'Failed' || !result.txHash) {
    console.error('Broadcast failed:', JSON.stringify(result, null, 2))
    throw new Error(`Transaction failed: ${(result as any).reason || (result as any).error || result.status}`)
  }
  console.log('Transaction:', result.txHash)
  console.log(`Explorer: https://explorer.solana.com/tx/${result.txHash}?cluster=devnet`)
  return result.txHash
}
