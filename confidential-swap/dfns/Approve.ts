import { encodeFunctionData, getAddress, maxUint256 } from 'viem'
import {
    broadcast,
    loadArtifact,
    loadDeployment,
    walletIdFor,
} from './DfnsCommon'

// usage: npm run approve -- <holder-role> <token-key>
//   token-key ∈ { plainToken, confSGD, confEUR }
//
// For the public ERC-20 we approve(swap, max).
// For the confidential ERC-7984 we setOperator(swap, far-future-timestamp).
// The spender is always the deployed ConfidentialSwap contract.
const OPERATOR_UNTIL: bigint = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60) // +1 year

async function main() {
    const role = process.argv[2]
    const tokenKey = process.argv[3] as 'plainToken' | 'confSGD' | 'confEUR' | undefined
    if (!role || !tokenKey) {
        throw new Error('Usage: approve <holder-role> <plainToken|confSGD|confEUR>')
    }

    const deployment = loadDeployment()
    const swap = deployment.swap
    const tokenAddress = deployment[tokenKey]
    if (!swap) throw new Error('swap not deployed yet')
    if (!tokenAddress) throw new Error(`${tokenKey} not deployed yet`)

    const walletId = walletIdFor(role)
    console.log(`Holder (${role}) walletId:`, walletId)
    console.log(`Token (${tokenKey}):       `, tokenAddress)
    console.log('Swap (spender):           ', swap)

    let data: `0x${string}`
    if (tokenKey === 'plainToken') {
        data = encodeFunctionData({
            abi: loadArtifact('PlainToken').abi,
            functionName: 'approve',
            args: [getAddress(swap), maxUint256],
        })
        console.log('Encoded ERC20 approve(swap, MAX).')
    } else {
        data = encodeFunctionData({
            abi: loadArtifact('ConfidentialToken').abi,
            functionName: 'setOperator',
            args: [getAddress(swap), OPERATOR_UNTIL],
        })
        console.log(`Encoded ERC7984 setOperator(swap, until=${OPERATOR_UNTIL}).`)
    }

    await broadcast(walletId, {
        kind: 'Eip1559',
        to: tokenAddress as `0x${string}`,
        data,
    })
    console.log('Approval set.')
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
