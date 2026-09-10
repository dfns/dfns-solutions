import { encodeFunctionData, getAddress } from 'viem'
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

// 200 cUSD with 6 decimals.
const TRANSFER_AMOUNT: bigint = 200_000_000n

async function main() {
    const { token } = loadDeployment()
    const senderAddress = await getWalletAddress(SENDER_WALLET_ID)
    const receiverAddress = await getWalletAddress(RECEIVER_WALLET_ID)
    console.log('Token:    ', token)
    console.log('Sender:   ', senderAddress)
    console.log('Receiver: ', receiverAddress)
    console.log('Amount:   ', TRANSFER_AMOUNT.toString())

    console.log('Initialising Zama relayer SDK (Sepolia)...')
    const fhevm = await createFhevmInstance()

    // Bind the encrypted input to (token, sender) — the caller is the sender.
    console.log('Encrypting amount...')
    const buf = fhevm.createEncryptedInput(getAddress(token), getAddress(senderAddress))
    buf.add64(TRANSFER_AMOUNT)
    const enc = await buf.encrypt()
    const handle = toHex(enc.handles[0])
    const proof = toHex(enc.inputProof)
    console.log('  handle:', handle)

    const data = encodeFunctionData({
        abi: loadArtifact('ConfidentialToken').abi,
        functionName: 'confidentialTransfer',
        args: [receiverAddress, handle, proof],
    })

    await broadcast(SENDER_WALLET_ID, {
        kind: 'Eip1559',
        to: token as `0x${string}`,
        data,
    })
    console.log('Confidential transfer broadcast.')
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
