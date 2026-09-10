import { encodeFunctionData, getAddress, parseEventLogs } from 'viem'
import {
    SENDER_WALLET_ID,
    RECEIVER_WALLET_ID,
    broadcast,
    createFhevmInstance,
    getWalletAddress,
    loadArtifact,
    loadDeployment,
    toHex,
} from './DfnsCommon'

// usage: npm run swap:ctoken-to-ctoken -- [amountA] [amountB]
//   default: amountA=100 (confSGD from sender -> receiver), amountB=80 (confEUR from receiver -> sender)
//
// Atomic two-party swap: the sender escrows amountA of confSGD on the swap contract
// while pinning the encrypted amountB they expect in confEUR. The receiver then fills
// the order, paying amountB in confEUR to the sender; the contract releases amountA
// of confSGD to the receiver in the same tx.
//
// Pre-requisites:
//   - sender has called setOperator(swap, ...) on confSGD (`npm run approve -- sender confSGD`)
//   - receiver has called setOperator(swap, ...) on confEUR (`npm run approve -- receiver confEUR`)
//   - both wallets hold sufficient confidential balances of their respective tokens
async function main() {
    const amountAUnits = BigInt(process.argv[2] ?? '100')
    const amountBUnits = BigInt(process.argv[3] ?? '80')
    const decimals = 6
    const amountA = amountAUnits * 10n ** BigInt(decimals)
    const amountB = amountBUnits * 10n ** BigInt(decimals)

    const { confSGD, confEUR, swap } = loadDeployment()
    if (!confSGD || !confEUR || !swap) throw new Error('Missing deployment entries')

    const senderAddress = await getWalletAddress(SENDER_WALLET_ID)
    const receiverAddress = await getWalletAddress(RECEIVER_WALLET_ID)
    console.log('Swap:            ', swap)
    console.log('Sender:          ', senderAddress)
    console.log('Receiver:        ', receiverAddress)
    console.log('Token A (sender→receiver):', confSGD)
    console.log('Token B (receiver→sender):', confEUR)
    console.log('Amount A (units): ', amountAUnits.toString())
    console.log('Amount B (units): ', amountBUnits.toString())

    console.log('\nInitialising Zama relayer SDK (Sepolia)...')
    const fhevm = await createFhevmInstance()

    // amountA: passed through to confSGD's confidentialTransferFrom(...externalEuint64...)
    //   so encryption binds to (confSGD, swap).
    console.log('Encrypting amountA bound to (confSGD, swap)...')
    const bufA = fhevm.createEncryptedInput(getAddress(confSGD), getAddress(swap))
    bufA.add64(amountA)
    const encA = await bufA.encrypt()
    const handleA = toHex(encA.handles[0])
    const proofA = toHex(encA.inputProof)
    console.log('  handleA:', handleA)

    // amountB: FHE.fromExternal runs inside the swap, so encryption binds to (swap, sender).
    console.log('Encrypting amountB bound to (swap, sender)...')
    const bufB = fhevm.createEncryptedInput(getAddress(swap), getAddress(senderAddress))
    bufB.add64(amountB)
    const encB = await bufB.encrypt()
    const handleB = toHex(encB.handles[0])
    const proofB = toHex(encB.inputProof)
    console.log('  handleB:', handleB)

    const swapAbi = loadArtifact('ConfidentialSwap').abi

    // --- Sender: createCTokenSwap ---
    console.log('\nSender creates the swap...')
    const createData = encodeFunctionData({
        abi: swapAbi,
        functionName: 'createCTokenSwap',
        args: [
            getAddress(confSGD),
            handleA,
            proofA,
            getAddress(confEUR),
            handleB,
            proofB,
            receiverAddress,
        ],
    })
    // Wait extra confirmations: fillCTokenSwap reads the swap state this tx writes,
    // and DFNS pre-flight-estimates the fill against its own RPC node, which can lag
    // the node we confirm against. Extra depth lets DFNS's node catch up.
    const createReceipt = await broadcast(
        SENDER_WALLET_ID,
        {
            kind: 'Eip1559',
            to: swap as `0x${string}`,
            data: createData,
        },
        { confirmations: 3 },
    )

    const events = parseEventLogs({
        abi: swapAbi,
        eventName: 'CTokenSwapCreated',
        logs: createReceipt.logs,
    }) as any[]
    if (events.length === 0) throw new Error('CTokenSwapCreated event not found')
    const swapId: bigint = events[0].args.swapId
    console.log('  swapId:', swapId.toString())

    // --- Receiver: fillCTokenSwap ---
    console.log('\nReceiver fills the swap...')
    const fillData = encodeFunctionData({
        abi: swapAbi,
        functionName: 'fillCTokenSwap',
        args: [swapId],
    })
    await broadcast(RECEIVER_WALLET_ID, {
        kind: 'Eip1559',
        to: swap as `0x${string}`,
        data: fillData,
    })

    console.log('\nAtomic cToken<->cToken swap complete.')
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
