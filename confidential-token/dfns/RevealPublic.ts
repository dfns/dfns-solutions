import { encodeFunctionData } from 'viem'
import {
    SENDER_WALLET_ID,
    RECEIVER_WALLET_ID,
    broadcast,
    createFhevmInstance,
    getWalletAddress,
    loadArtifact,
    loadDeployment,
    publicClient,
} from './DfnsCommon'

// Which holder makes their balance publicly decryptable.
const HOLDER: 'sender' | 'receiver' = (process.argv[2] as any) || 'receiver'

async function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms))
}

async function main() {
    const { token } = loadDeployment()
    const walletId = HOLDER === 'sender' ? SENDER_WALLET_ID : RECEIVER_WALLET_ID
    const holderAddress = await getWalletAddress(walletId)
    console.log('Token: ', token)
    console.log(`Holder (${HOLDER}):`, holderAddress)

    const abi = loadArtifact('ConfidentialToken').abi

    // 1. Read the encrypted balance handle.
    const handle = (await publicClient.readContract({
        address: token as `0x${string}`,
        abi,
        functionName: 'confidentialBalanceOf',
        args: [holderAddress],
    })) as `0x${string}`
    console.log('Encrypted balance handle:', handle)

    if (/^0x0+$/.test(handle)) {
        throw new Error('Balance handle is zero — nothing to disclose.')
    }

    // 2. Mark the handle publicly decryptable on-chain.
    //    ERC7984.requestDiscloseEncryptedAmount(euint64) -> FHE.makePubliclyDecryptable(amount)
    console.log('Calling requestDiscloseEncryptedAmount...')
    const data = encodeFunctionData({
        abi,
        functionName: 'requestDiscloseEncryptedAmount',
        args: [handle],
    })
    await broadcast(walletId, {
        kind: 'Eip1559',
        to: token as `0x${string}`,
        data,
    })

    // 3. Ask the relayer for the cleartext. Allow a few retries while the KMS
    //    picks up the new public-decryption permission.
    console.log('Initialising Zama relayer SDK (Sepolia)...')
    const fhevm = await createFhevmInstance()

    for (let attempt = 1; attempt <= 10; attempt++) {
        try {
            const result = await fhevm.publicDecrypt([handle])
            const cleartext = result.clearValues[handle]
            console.log('Publicly decrypted balance (raw):', cleartext?.toString())
            if (typeof cleartext === 'bigint') {
                console.log('Publicly decrypted balance (cUSD):', Number(cleartext) / 1e6)
            }
            return
        } catch (e: any) {
            console.log(`  attempt ${attempt} failed: ${e?.message || e}`)
            if (attempt === 10) throw e
            await sleep(3000)
        }
    }
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
