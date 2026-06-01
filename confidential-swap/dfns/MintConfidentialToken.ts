import { encodeFunctionData, getAddress, isAddress } from 'viem'
import {
    BANK_WALLET_ID,
    broadcast,
    createFhevmInstance,
    getWalletAddress,
    loadArtifact,
    loadDeployment,
    toHex,
    walletIdFor,
} from './DfnsCommon'

// usage: npm run mint:ctoken -- <confSGD|confEUR> <role|address|swap> <amount-in-token-units>
//   e.g.  npm run mint:ctoken -- confSGD sender 1000
//         npm run mint:ctoken -- confSGD swap 5000
//         npm run mint:ctoken -- confEUR receiver 1000
//
// 6 decimals fixed (matches ERC7984 default), so "1000" becomes 1_000_000_000.
const DECIMALS = 6

async function main() {
    const tokenKey = process.argv[2] as 'confSGD' | 'confEUR' | undefined
    const target = process.argv[3]
    const amountArg = process.argv[4]
    if (!tokenKey || !target || !amountArg) {
        throw new Error('Usage: mint:ctoken <confSGD|confEUR> <role|address|swap> <amount-in-token-units>')
    }

    const deployment = loadDeployment()
    const token = deployment[tokenKey]
    if (!token) throw new Error(`${tokenKey} not deployed yet`)
    const amount = BigInt(amountArg) * 10n ** BigInt(DECIMALS)

    let recipient: `0x${string}`
    if (isAddress(target)) {
        recipient = getAddress(target)
    } else if (target === 'swap') {
        if (!deployment.swap) throw new Error('swap not deployed yet')
        recipient = getAddress(deployment.swap)
    } else {
        recipient = await getWalletAddress(walletIdFor(target))
    }

    const bankAddress = await getWalletAddress(BANK_WALLET_ID)
    console.log(`${tokenKey} (${deployment[`${tokenKey}Symbol`]}):`, token)
    console.log('Minter (bank):', bankAddress)
    console.log('Recipient:    ', recipient, target === 'swap' ? '(swap reserve)' : `(${target})`)
    console.log('Amount (raw): ', amount.toString())

    console.log('Initialising Zama relayer SDK (Sepolia)...')
    const fhevm = await createFhevmInstance()

    console.log('Encrypting amount...')
    const buf = fhevm.createEncryptedInput(getAddress(token), getAddress(bankAddress))
    buf.add64(amount)
    const enc = await buf.encrypt()
    const handle = toHex(enc.handles[0])
    const proof = toHex(enc.inputProof)
    console.log('  handle:', handle)

    const data = encodeFunctionData({
        abi: loadArtifact('ConfidentialToken').abi,
        functionName: 'mint',
        args: [recipient, handle, proof],
    })

    await broadcast(BANK_WALLET_ID, {
        kind: 'Eip1559',
        to: token as `0x${string}`,
        data,
    })
    console.log('Minted.')
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
