import { getAddress } from 'viem'
import {
    SENDER_WALLET_ID,
    RECEIVER_WALLET_ID,
    SEPOLIA_CHAIN_ID,
    createFhevmInstance,
    dfnsSignTypedData,
    getWalletAddress,
    loadArtifact,
    loadDeployment,
    publicClient,
} from './DfnsCommon'

// Which holder reveals their balance: 'sender' or 'receiver'.
const HOLDER: 'sender' | 'receiver' = (process.argv[2] as any) || 'receiver'

async function main() {
    const { token: rawToken } = loadDeployment()
    const walletId = HOLDER === 'sender' ? SENDER_WALLET_ID : RECEIVER_WALLET_ID
    const rawHolder = await getWalletAddress(walletId)
    // node-tkms requires EIP-55 checksummed addresses.
    const token = getAddress(rawToken)
    const holderAddress = getAddress(rawHolder)
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
        console.log('Balance handle is zero — nothing to decrypt.')
        return
    }

    // 2. Init the relayer SDK and prepare the user-decryption EIP-712.
    console.log('Initialising Zama relayer SDK (Sepolia)...')
    const fhevm = await createFhevmInstance()

    const keypair = fhevm.generateKeypair()
    const startTimestamp = Math.floor(Date.now() / 1000)
    const durationDays = 1

    const eip712 = fhevm.createEIP712(
        keypair.publicKey,
        [token],
        startTimestamp,
        durationDays,
    )

    // 3. Sign the typed data via DFNS (the relayer-SDK example omits EIP712Domain
    //    from the types passed to the signer; ethers does the same.)
    const { EIP712Domain, ...nonDomainTypes } = eip712.types as any
    console.log('Requesting EIP-712 signature from DFNS...')
    const signature = await dfnsSignTypedData(walletId, {
        domain: {
            name: eip712.domain.name,
            version: eip712.domain.version,
            chainId: SEPOLIA_CHAIN_ID,
            verifyingContract: eip712.domain.verifyingContract,
        },
        types: nonDomainTypes,
        message: eip712.message as Record<string, unknown>,
    })
    console.log('  signature:', signature.slice(0, 12) + '…')

    // 4. Ask the relayer to decrypt for this holder.
    console.log('Calling userDecrypt via relayer...')
    const result = await fhevm.userDecrypt(
        [{ handle, contractAddress: token }],
        keypair.privateKey,
        keypair.publicKey,
        signature.replace(/^0x/, ''),
        [token],
        holderAddress,
        startTimestamp,
        durationDays,
    )

    const cleartext = result[handle]
    console.log('Decrypted balance (raw):', cleartext?.toString())
    if (typeof cleartext === 'bigint') {
        console.log('Decrypted balance (cUSD):', Number(cleartext) / 1e6)
    }
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
