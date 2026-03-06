import * as anchor from '@coral-xyz/anchor'
import { Program } from '@coral-xyz/anchor'
import type { CrossBorderPayment } from '../target/types/cross_border_payment.js'
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
} from '@solana/spl-token'
import { PublicKey, Keypair, SystemProgram } from '@solana/web3.js'
import { expect } from 'chai'

describe('cross-border-payment', () => {
  const provider = anchor.AnchorProvider.env()
  anchor.setProvider(provider)

  const program = anchor.workspace.CrossBorderPayment as Program<CrossBorderPayment>
  const sender = (provider.wallet as anchor.Wallet).payer
  const receiver = Keypair.generate()
  const authority = sender

  let sourceMint: PublicKey
  let targetMint: PublicKey
  let senderSourceAta: PublicKey
  let receiverTargetAta: PublicKey

  const paymentId = new anchor.BN(Date.now())
  const amountIn = new anchor.BN(500000) // 0.5 tokens
  const amountOut = new anchor.BN(800000) // 0.8 tokens (mocked FX rate)

  let paymentPda: PublicKey
  let paymentBump: number

  before(async () => {
    sourceMint = await createMint(provider.connection, sender, authority.publicKey, null, 6)
    targetMint = await createMint(provider.connection, sender, authority.publicKey, null, 6)

    senderSourceAta = await createAssociatedTokenAccount(
      provider.connection,
      sender,
      sourceMint,
      sender.publicKey,
    )
    receiverTargetAta = await createAssociatedTokenAccount(
      provider.connection,
      sender,
      targetMint,
      receiver.publicKey,
    )

    await mintTo(provider.connection, sender, sourceMint, senderSourceAta, authority, 1000000)

    ;[paymentPda, paymentBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('payment'), sender.publicKey.toBuffer(), paymentId.toArrayLike(Buffer, 'le', 8)],
      program.programId,
    )
  })

  it('Initializes a payment', async () => {
    await program.methods
      .initializePayment(paymentId, amountIn)
      .accounts({
        payment: paymentPda,
        sender: sender.publicKey,
        receiver: receiver.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc()

    const paymentAccount = await program.account.payment.fetch(paymentPda)
    expect(paymentAccount.id.toString()).to.equal(paymentId.toString())
    expect(paymentAccount.sender.toBase58()).to.equal(sender.publicKey.toBase58())
    expect(paymentAccount.receiver.toBase58()).to.equal(receiver.publicKey.toBase58())
    expect(paymentAccount.amountIn.toString()).to.equal(amountIn.toString())
    expect(paymentAccount.amountOut.toString()).to.equal('0')
    expect(paymentAccount.status).to.deep.equal({ pendingFx: {} })
  })

  it('Sets FX rate', async () => {
    await program.methods
      .setFxRate(paymentId, amountOut)
      .accounts({
        payment: paymentPda,
        authority: authority.publicKey,
      } as any)
      .rpc()

    const paymentAccount = await program.account.payment.fetch(paymentPda)
    expect(paymentAccount.amountOut.toString()).to.equal(amountOut.toString())
    expect(paymentAccount.status).to.deep.equal({ fxRateSet: {} })
  })

  it('Executes the payment (burn & mint)', async () => {
    await program.methods
      .executePayment(paymentId)
      .accounts({
        payment: paymentPda,
        sender: sender.publicKey,
        sourceMint: sourceMint,
        senderSourceAta: senderSourceAta,
        targetMint: targetMint,
        receiverTargetAta: receiverTargetAta,
        targetMintAuthority: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .rpc()

    const paymentAccount = await program.account.payment.fetch(paymentPda)
    expect(paymentAccount.status).to.deep.equal({ completed: {} })

    const senderTokenAccount = await getAccount(provider.connection, senderSourceAta)
    expect(senderTokenAccount.amount.toString()).to.equal('500000')

    const receiverTokenAccount = await getAccount(provider.connection, receiverTargetAta)
    expect(receiverTokenAccount.amount.toString()).to.equal('800000')
  })

  it('Fails if re-initializing same payment', async () => {
    try {
      await program.methods
        .initializePayment(paymentId, amountIn)
        .accounts({
          payment: paymentPda,
          sender: sender.publicKey,
          receiver: receiver.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc()
      expect.fail('Should have failed')
    } catch (err: any) {
      expect(err.logs.toString()).to.contain('already in use')
    }
  })
})
