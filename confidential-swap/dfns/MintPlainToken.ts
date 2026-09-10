import { encodeFunctionData, getAddress, isAddress } from 'viem'
import {
    BANK_WALLET_ID,
    broadcast,
    getWalletAddress,
    loadArtifact,
    loadDeployment,
    walletIdFor,
} from './DfnsCommon'

// usage: npm run mint:plain -- <role|address> <amount-in-token-units>
//   e.g.  npm run mint:plain -- sender 1000
//         npm run mint:plain -- swap 5000
//         npm run mint:plain -- 0xabc... 100
async function main() {
    const target = process.argv[2]
    const amountArg = process.argv[3]
    if (!target || !amountArg) {
        throw new Error('Usage: mint:plain <role|address> <amount-in-token-units>')
    }

    const { plainToken, plainTokenDecimals, swap } = loadDeployment()
    if (!plainToken) throw new Error('plainToken not deployed yet')
    const decimals = Number(plainTokenDecimals ?? 6)
    const amount = BigInt(amountArg) * 10n ** BigInt(decimals)

    let recipient: `0x${string}`
    if (isAddress(target)) {
        recipient = getAddress(target)
    } else if (target === 'swap') {
        if (!swap) throw new Error('swap not deployed yet')
        recipient = getAddress(swap)
    } else {
        recipient = await getWalletAddress(walletIdFor(target))
    }

    console.log('PlainToken:    ', plainToken)
    console.log('Recipient:     ', recipient, target === 'swap' ? '(swap reserve)' : `(${target})`)
    console.log('Amount (raw):  ', amount.toString())
    console.log('Amount (token):', amountArg)

    const data = encodeFunctionData({
        abi: loadArtifact('PlainToken').abi,
        functionName: 'mint',
        args: [recipient, amount],
    })

    await broadcast(BANK_WALLET_ID, {
        kind: 'Eip1559',
        to: plainToken as `0x${string}`,
        data,
    })
    console.log('Minted.')
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
