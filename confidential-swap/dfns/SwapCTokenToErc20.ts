import { encodeFunctionData, getAddress, parseEventLogs } from 'viem'
import {
    SENDER_WALLET_ID,
    broadcast,
    createFhevmInstance,
    getWalletAddress,
    loadArtifact,
    loadDeployment,
    publicClient,
    toHex,
} from './DfnsCommon'

// usage: npm run swap:ctoken-to-erc20 -- [amount-in-token-units]
//   default: 50
//
// Two on-chain steps + one off-chain step:
//   1. initiateCTokenToErc20 — pulls encrypted cToken into the swap, makes the
//      transferred-amount handle publicly decryptable.
//   2. relayer.publicDecrypt([handle]) — KMS produces cleartext + signatures.
//   3. finalizeCTokenToErc20 — verifies the KMS signatures on-chain and releases
//      the matching ERC-20 amount to the recipient.
//
// Pre-requisites:
//   - sender has called setOperator(swap, ...) on confSGD (`npm run approve -- sender confSGD`)
//   - swap holds a sufficient plainToken reserve (`npm run mint:plain -- swap 5000`)
async function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms))
}

async function main() {
    const amountInUnits = BigInt(process.argv[2] ?? '50')
    const decimals = 6
    const amount = amountInUnits * 10n ** BigInt(decimals)

    const { plainToken, confSGD, swap } = loadDeployment()
    if (!plainToken || !confSGD || !swap) throw new Error('Missing deployment entries')

    const senderAddress = await getWalletAddress(SENDER_WALLET_ID)
    console.log('Swap:            ', swap)
    console.log('Sender (caller): ', senderAddress)
    console.log('cToken in:       ', confSGD)
    console.log('ERC-20 out:      ', plainToken)
    console.log('Amount (units):  ', amountInUnits.toString())
    console.log('Amount (raw):    ', amount.toString())

    console.log('\nInitialising Zama relayer SDK (Sepolia)...')
    const fhevm = await createFhevmInstance()

    // The encrypted input passes through swap to cToken; cToken does FHE.fromExternal,
    // so the binding is (contract=cToken, caller=swap).
    console.log('Encrypting amount bound to (cToken, swap)...')
    const buf = fhevm.createEncryptedInput(getAddress(confSGD), getAddress(swap))
    buf.add64(amount)
    const enc = await buf.encrypt()
    const handle = toHex(enc.handles[0])
    const proof = toHex(enc.inputProof)
    console.log('  handle:', handle)

    // --- Step 1: initiate ---
    console.log('\nStep 1: initiateCTokenToErc20...')
    const swapAbi = loadArtifact('ConfidentialSwap').abi
    const initiateData = encodeFunctionData({
        abi: swapAbi,
        functionName: 'initiateCTokenToErc20',
        args: [getAddress(confSGD), getAddress(plainToken), handle, proof, senderAddress],
    })
    const initiateReceipt = await broadcast(SENDER_WALLET_ID, {
        kind: 'Eip1559',
        to: swap as `0x${string}`,
        data: initiateData,
    })

    const events = parseEventLogs({
        abi: swapAbi,
        eventName: 'CTokenToErc20Initiated',
        logs: initiateReceipt.logs,
    }) as any[]
    if (events.length === 0) throw new Error('CTokenToErc20Initiated event not found')
    const swapId: bigint = events[0].args.swapId
    const amountHandle: `0x${string}` = events[0].args.amountHandle
    console.log('  swapId:        ', swapId.toString())
    console.log('  amountHandle:  ', amountHandle)

    // --- Step 2: relayer public-decrypt ---
    console.log('\nStep 2: publicDecrypt via relayer (KMS may need a few seconds)...')
    let publicResult: Awaited<ReturnType<typeof fhevm.publicDecrypt>> | undefined
    for (let attempt = 1; attempt <= 12; attempt++) {
        try {
            publicResult = await fhevm.publicDecrypt([amountHandle])
            break
        } catch (e: any) {
            console.log(`  attempt ${attempt} failed: ${e?.message || e}`)
            if (attempt === 12) throw e
            await sleep(3000)
        }
    }
    if (!publicResult) throw new Error('publicDecrypt never succeeded')
    const cleartext = publicResult.clearValues[amountHandle]
    if (typeof cleartext !== 'bigint') {
        throw new Error('publicDecrypt did not return a bigint for the handle')
    }
    console.log('  cleartext:     ', cleartext.toString())
    console.log('  decryptionProof:', publicResult.decryptionProof.slice(0, 12) + '…')

    // --- Step 3: finalize ---
    console.log('\nStep 3: finalizeCTokenToErc20...')
    const finalizeData = encodeFunctionData({
        abi: swapAbi,
        functionName: 'finalizeCTokenToErc20',
        args: [swapId, cleartext, publicResult.decryptionProof],
    })
    await broadcast(SENDER_WALLET_ID, {
        kind: 'Eip1559',
        to: swap as `0x${string}`,
        data: finalizeData,
    })

    console.log('\nSwap complete (cToken -> ERC20). Released', (Number(cleartext) / 10 ** decimals).toString(), 'units.')
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
