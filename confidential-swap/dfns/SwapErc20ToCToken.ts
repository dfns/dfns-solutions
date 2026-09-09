import { encodeFunctionData, getAddress } from 'viem'
import {
    SENDER_WALLET_ID,
    broadcast,
    getWalletAddress,
    loadArtifact,
    loadDeployment,
} from './DfnsCommon'

// usage: npm run swap:erc20-to-ctoken -- [amount-in-token-units]
//   default: 100
//
// Caller (SENDER) trades public ERC-20 for an encrypted cToken balance.
// Pre-requisites:
//   - sender has approved the swap on plainToken (`npm run approve -- sender plainToken`)
//   - swap holds a sufficient confSGD confidential reserve (`npm run mint:ctoken -- confSGD swap 5000`)
async function main() {
    const amountInUnits = BigInt(process.argv[2] ?? '100')
    const decimals = 6
    const amount = amountInUnits * 10n ** BigInt(decimals)

    const { plainToken, confSGD, swap } = loadDeployment()
    if (!plainToken || !confSGD || !swap) throw new Error('Missing deployment entries')

    const senderAddress = await getWalletAddress(SENDER_WALLET_ID)
    console.log('Swap:           ', swap)
    console.log('Sender (caller):', senderAddress)
    console.log('ERC-20 in:      ', plainToken)
    console.log('cToken out:     ', confSGD)
    console.log('Amount (units): ', amountInUnits.toString())
    console.log('Amount (raw):   ', amount.toString())

    const data = encodeFunctionData({
        abi: loadArtifact('ConfidentialSwap').abi,
        functionName: 'swapErc20ToCToken',
        args: [getAddress(plainToken), getAddress(confSGD), senderAddress, amount],
    })

    await broadcast(SENDER_WALLET_ID, {
        kind: 'Eip1559',
        to: swap as `0x${string}`,
        data,
    })
    console.log('Swap complete (ERC20 -> cToken).')
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
