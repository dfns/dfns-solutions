import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
} from '@solana/web3.js'
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
} from '@solana/spl-token'
import {
  createMetadataAccountV3,
  MPL_TOKEN_METADATA_PROGRAM_ID,
} from '@metaplex-foundation/mpl-token-metadata'
import type {
  CreateMetadataAccountV3InstructionAccounts,
  CreateMetadataAccountV3InstructionArgs,
} from '@metaplex-foundation/mpl-token-metadata'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { fromWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters'
import { dfnsApi, BANK_WALLET_ID } from './DfnsClient.js'

async function main() {
  const args = process.argv.slice(2)
  const tokenName = args[0]
  const tokenSymbol = args[1]

  if (!tokenName || !tokenSymbol) {
    console.error('Usage: npx tsx dfns/deploy-stablecoin.ts <name> <symbol>')
    console.error('Example: npx tsx dfns/deploy-stablecoin.ts "Test EUR" tEUR')
    process.exit(1)
  }

  console.log(`Deploying stablecoin: ${tokenName} (${tokenSymbol})`)

  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed')

  const wallet = await dfnsApi.wallets.getWallet({ walletId: BANK_WALLET_ID })
  const payerPublicKey = new PublicKey(wallet.address!)
  console.log(`Payer (Dfns Wallet): ${payerPublicKey.toBase58()}`)

  const mintKeypair = Keypair.generate()
  console.log(`Mint Address: ${mintKeypair.publicKey.toBase58()}`)

  const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE)

  const transaction = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payerPublicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      6,
      payerPublicKey, // Mint Authority
      payerPublicKey, // Freeze Authority
    ),
  )

  // Add Metaplex metadata
  const umi = createUmi(clusterApiUrl('devnet'))

  const [metadataPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID).toBuffer(),
      mintKeypair.publicKey.toBuffer(),
    ],
    new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID),
  )

  const accounts: CreateMetadataAccountV3InstructionAccounts = {
    metadata: fromWeb3JsPublicKey(metadataPDA),
    mint: fromWeb3JsPublicKey(mintKeypair.publicKey),
    mintAuthority: fromWeb3JsPublicKey(payerPublicKey) as any,
    payer: fromWeb3JsPublicKey(payerPublicKey) as any,
    updateAuthority: fromWeb3JsPublicKey(payerPublicKey) as any,
  }

  const metadataArgs: CreateMetadataAccountV3InstructionArgs = {
    data: {
      name: tokenName,
      symbol: tokenSymbol,
      uri: '',
      sellerFeeBasisPoints: 0,
      creators: null,
      collection: null,
      uses: null,
    },
    isMutable: true,
    collectionDetails: null,
  }

  const metadataIx = createMetadataAccountV3(umi, {
    ...accounts,
    ...metadataArgs,
  }).getInstructions()[0]

  if (metadataIx) {
    transaction.add({
      keys: metadataIx.keys.map((k) => ({
        pubkey: new PublicKey(k.pubkey),
        isSigner: k.isSigner,
        isWritable: k.isWritable,
      })),
      programId: new PublicKey(metadataIx.programId),
      data: Buffer.from(metadataIx.data),
    })
  }

  const { blockhash } = await connection.getLatestBlockhash()
  transaction.recentBlockhash = blockhash
  transaction.feePayer = payerPublicKey
  transaction.partialSign(mintKeypair)

  console.log('Broadcasting via Dfns...')
  const serializedTransaction = transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString('hex')

  const result = await dfnsApi.wallets.broadcastTransaction({
    walletId: BANK_WALLET_ID,
    body: { kind: 'Transaction', transaction: serializedTransaction } as any,
  })

  console.log('Transaction:', result.txHash)
  console.log(`Explorer: https://explorer.solana.com/address/${mintKeypair.publicKey.toBase58()}?cluster=devnet`)
  const envHint = args.length > 2 ? args[2] : (tokenSymbol.toLowerCase().includes('sgd') || tokenSymbol.toLowerCase().includes('target') ? 'TARGET_MINT' : 'SOURCE_MINT')
  console.log(`\nAdd to your .env: ${envHint}=${mintKeypair.publicKey.toBase58()}`)
}

main().catch((err) => {
  console.error('Deployment failed:', err)
  if (err.context) console.error('Context:', JSON.stringify(err.context, null, 2))
})
