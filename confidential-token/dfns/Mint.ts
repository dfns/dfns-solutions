import { encodeFunctionData, getAddress } from 'viem'
import {
    BANK_WALLET_ID,
    SENDER_WALLET_ID,
    broadcast,
    createFhevmInstance,
    getWalletAddress,
    loadArtifact,
    loadDeployment,
    toHex,
} from './DfnsCommon'

// 6 decimals — 1000 cUSD = 1_000_000_000.
const MINT_AMOUNT: bigint = 1_000_000_000n

async function main() {
    const { token } = loadDeployment()
    const bankAddress = await getWalletAddress(BANK_WALLET_ID)
    const senderAddress = await getWalletAddress(SENDER_WALLET_ID)
    console.log('Token:        ', token)
    console.log('Minter (bank):', bankAddress)
    console.log('Recipient:    ', senderAddress)
    console.log('Amount (raw): ', MINT_AMOUNT.toString())

    console.log('Initialising Zama relayer SDK (Sepolia)...')
    const fhevm = await createFhevmInstance()

    console.log('Encrypting amount...')
    const buf = fhevm.createEncryptedInput(getAddress(token), getAddress(bankAddress))
    buf.add64(MINT_AMOUNT)
    const enc = await buf.encrypt()
    const handle = toHex(enc.handles[0])
    const proof = toHex(enc.inputProof)
    console.log('  handle:', handle)

    const data = encodeFunctionData({
        abi: loadArtifact('ConfidentialToken').abi,
        functionName: 'mint',
        args: [senderAddress, handle, proof],
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
