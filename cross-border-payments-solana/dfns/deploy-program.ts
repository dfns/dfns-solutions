import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  clusterApiUrl,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  getInitializeBufferInstruction,
  getWriteInstruction,
  getDeployWithMaxDataLenInstruction,
  getUpgradeInstruction,
} from '@solana-program/loader-v3'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dfnsApi, BANK_WALLET_ID } from './DfnsClient.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const CHUNK_SIZE = 800
const BATCH_SIZE = 5
const BPF_LOADER_UPGRADEABLE_ID = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111')

/** Convert @solana/kit (v2) instructions to @solana/web3.js (v1) format */
function toWeb3JsInstruction(ix: any): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys: ix.accounts.map((acc: any) => ({
      pubkey: new PublicKey(acc.address),
      isSigner: (acc.role & 2) !== 0,
      isWritable: (acc.role & 1) !== 0,
    })),
    data: Buffer.from(ix.data),
  })
}

async function main() {
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed')

  // 1. Get Dfns wallet (upgrade authority & payer)
  const wallet = await dfnsApi.wallets.getWallet({ walletId: BANK_WALLET_ID })
  const authority = new PublicKey(wallet.address!)
  console.log(`Authority (Dfns Wallet): ${authority.toBase58()}`)

  // 2. Load program binary
  const programPath = path.join(__dirname, '../target/deploy/cross_border_payment.so')
  if (!fs.existsSync(programPath)) {
    console.error(`Program binary not found at ${programPath}. Run \`anchor build\` first.`)
    return
  }
  const programBuffer = fs.readFileSync(programPath)
  console.log(`Program size: ${programBuffer.length} bytes`)

  // 3. Create or reuse buffer account
  let bufferAddress: PublicKey
  const potentialBuffer = process.argv.slice(2).find((arg) => arg.length >= 32 && arg.length <= 44)
  const existingBuffer = potentialBuffer ? new PublicKey(potentialBuffer) : null

  if (existingBuffer) {
    console.log(`Reusing buffer: ${existingBuffer.toBase58()}`)
    bufferAddress = existingBuffer
  } else {
    const bufferKeypair = Keypair.generate()
    bufferAddress = bufferKeypair.publicKey
    console.log(`Creating buffer: ${bufferAddress.toBase58()}`)

    const bufferRent = await connection.getMinimumBalanceForRentExemption(programBuffer.length + 37)

    const createBufferTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: authority,
        newAccountPubkey: bufferAddress,
        lamports: bufferRent,
        space: programBuffer.length + 37,
        programId: BPF_LOADER_UPGRADEABLE_ID,
      }),
      toWeb3JsInstruction(
        getInitializeBufferInstruction({
          sourceAccount: bufferAddress.toBase58() as any,
          bufferAuthority: authority.toBase58() as any,
        }),
      ),
    )

    const { blockhash } = await connection.getLatestBlockhash()
    createBufferTx.recentBlockhash = blockhash
    createBufferTx.feePayer = authority
    createBufferTx.partialSign(bufferKeypair)

    const createResult = await dfnsApi.wallets.broadcastTransaction({
      walletId: BANK_WALLET_ID,
      body: {
        kind: 'Transaction',
        transaction: createBufferTx.serialize({ requireAllSignatures: false }).toString('hex'),
      } as any,
    })

    if (!createResult.txHash || (createResult as any).status === 'Failed') {
      console.error('Buffer creation failed!', JSON.stringify(createResult, null, 2))
      return
    }
    console.log('Buffer created:', createResult.txHash)
  }

  // 4. Upload chunks
  const bufferInfo = await connection.getAccountInfo(bufferAddress)
  const currentBufferData = bufferInfo?.data.slice(37) || Buffer.alloc(0)

  console.log(`Uploading ${programBuffer.length} bytes...`)
  for (let offset = 0; offset < programBuffer.length; offset += CHUNK_SIZE * BATCH_SIZE) {
    const batchPromises = []

    for (let i = 0; i < BATCH_SIZE && offset + i * CHUNK_SIZE < programBuffer.length; i++) {
      const currentOffset = offset + i * CHUNK_SIZE
      const chunk = programBuffer.slice(currentOffset, currentOffset + CHUNK_SIZE)

      if (currentBufferData && currentOffset + chunk.length <= currentBufferData.length) {
        const existingChunk = currentBufferData.slice(currentOffset, currentOffset + chunk.length)
        if (chunk.equals(existingChunk)) continue
      }

      const writeIx = toWeb3JsInstruction(
        getWriteInstruction({
          bufferAccount: bufferAddress.toBase58() as any,
          bufferAuthority: authority.toBase58() as any,
          offset: currentOffset,
          bytes: new Uint8Array(chunk),
        }),
      )

      const writeTx = new Transaction().add(writeIx)
      batchPromises.push(
        (async () => {
          const { blockhash: chunkBh } = await connection.getLatestBlockhash('confirmed')
          writeTx.recentBlockhash = chunkBh
          writeTx.feePayer = authority
          return dfnsApi.wallets.broadcastTransaction({
            walletId: BANK_WALLET_ID,
            body: {
              kind: 'Transaction',
              transaction: writeTx.serialize({ requireAllSignatures: false }).toString('hex'),
            } as any,
          })
        })(),
      )
    }

    if (batchPromises.length > 0) await Promise.all(batchPromises)
  }
  console.log('Upload complete!')

  // 5. Deploy or upgrade
  const programKeypairPath = path.join(__dirname, '../target/deploy/cross_border_payment-keypair.json')
  const programKeypairData = JSON.parse(fs.readFileSync(programKeypairPath, 'utf8'))
  const programKeypair = Keypair.fromSecretKey(Uint8Array.from(programKeypairData))
  const programId = programKeypair.publicKey

  console.log(`Program ID: ${programId.toBase58()}`)

  const programAccount = await connection.getAccountInfo(programId)

  if (!programAccount) {
    console.log('Deploying new program...')

    const programRent = await connection.getMinimumBalanceForRentExemption(36)
    const createProgramAccountIx = SystemProgram.createAccount({
      fromPubkey: authority,
      newAccountPubkey: programId,
      lamports: programRent,
      space: 36,
      programId: BPF_LOADER_UPGRADEABLE_ID,
    })

    const programDataAddress = PublicKey.findProgramAddressSync(
      [programId.toBuffer()],
      BPF_LOADER_UPGRADEABLE_ID,
    )[0]

    const deployIx = toWeb3JsInstruction(
      getDeployWithMaxDataLenInstruction({
        payerAccount: authority.toBase58() as any,
        programDataAccount: programDataAddress.toBase58() as any,
        programAccount: programId.toBase58() as any,
        bufferAccount: bufferAddress.toBase58() as any,
        authority: authority.toBase58() as any,
        maxDataLen: programBuffer.length,
      }),
    )

    const deployTx = new Transaction().add(createProgramAccountIx, deployIx)
    const { blockhash: deployBh } = await connection.getLatestBlockhash('finalized')
    deployTx.recentBlockhash = deployBh
    deployTx.feePayer = authority
    deployTx.partialSign(programKeypair)

    const deployResult = await dfnsApi.wallets.broadcastTransaction({
      walletId: BANK_WALLET_ID,
      body: {
        kind: 'Transaction',
        transaction: deployTx.serialize({ requireAllSignatures: false }).toString('hex'),
      } as any,
    })

    if (!deployResult.txHash || (deployResult as any).status === 'Failed') {
      console.error('Deployment failed!', JSON.stringify(deployResult, null, 2))
      return
    }
    console.log('Deployed:', deployResult.txHash)
  } else {
    console.log('Upgrading existing program...')

    const programDataAddress = PublicKey.findProgramAddressSync(
      [programId.toBuffer()],
      BPF_LOADER_UPGRADEABLE_ID,
    )[0]

    const upgradeIx = toWeb3JsInstruction(
      getUpgradeInstruction({
        programDataAccount: programDataAddress.toBase58() as any,
        programAccount: programId.toBase58() as any,
        bufferAccount: bufferAddress.toBase58() as any,
        spillAccount: authority.toBase58() as any,
        authority: authority.toBase58() as any,
      }),
    )

    const upgradeTx = new Transaction().add(upgradeIx)
    const { blockhash: upgradeBh } = await connection.getLatestBlockhash('finalized')
    upgradeTx.recentBlockhash = upgradeBh
    upgradeTx.feePayer = authority

    const upgradeResult = await dfnsApi.wallets.broadcastTransaction({
      walletId: BANK_WALLET_ID,
      body: {
        kind: 'Transaction',
        transaction: upgradeTx.serialize({ requireAllSignatures: false }).toString('hex'),
      } as any,
    })
    console.log('Upgraded:', upgradeResult.txHash)
  }

  console.log(`\nProgram ID: ${programId.toBase58()}`)
  console.log(`Authority:  ${authority.toBase58()}`)
  console.log(`Explorer:   https://explorer.solana.com/address/${programId.toBase58()}?cluster=devnet`)
}

main().catch((err) => {
  console.error('Deployment failed:', err)
  if (err.context) console.error('Context:', JSON.stringify(err.context, null, 2))
})
