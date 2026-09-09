import { erc20Abi, formatUnits, getAddress, isAddress } from 'viem'
import { DfnsApiClient } from '@dfns/sdk'
import {
    SEPOLIA_CHAIN_ID,
    createFhevmInstance,
    dfnsApi,
    getWalletAddress,
    loadArtifact,
    loadDeployment,
    publicClient,
    walletIdFor,
} from './DfnsCommon'

// usage: npm run reveal -- <holder-role> <token-key>
//   token-key ∈ { plainToken, confSGD, confEUR }
//   holder-role ∈ { bank, sender, receiver, swap }
//
// For plainToken: just calls ERC20.balanceOf.
// For confSGD/confEUR: pulls the encrypted handle, asks the relayer to user-decrypt
//                     it (EIP-712 signed by the holder's DFNS wallet).
async function dfnsSignTypedData(
    api: DfnsApiClient,
    walletId: string,
    typedData: {
        domain: Record<string, unknown>
        types: Record<string, { name: string; type: string }[]>
        message: Record<string, unknown>
    },
): Promise<`0x${string}`> {
    const res = await api.wallets.generateSignature({
        walletId,
        body: {
            kind: 'Eip712' as const,
            types: typedData.types,
            domain: typedData.domain,
            message: typedData.message,
        } as any,
    })
    if (!res.signature?.encoded) {
        throw new Error(`DFNS signature failed: ${JSON.stringify(res)}`)
    }
    return res.signature.encoded as `0x${string}`
}

async function main() {
    const role = process.argv[2]
    const tokenKey = process.argv[3] as 'plainToken' | 'confSGD' | 'confEUR' | undefined
    if (!role || !tokenKey) {
        throw new Error('Usage: reveal <bank|sender|receiver|swap> <plainToken|confSGD|confEUR>')
    }

    const deployment = loadDeployment()
    const tokenAddress = deployment[tokenKey]
    if (!tokenAddress) throw new Error(`${tokenKey} not deployed yet`)

    // Resolve holder address. "swap" is a special pseudo-role for inspecting the
    // swap contract's reserve balance.
    let holderAddress: `0x${string}`
    let walletId: string | undefined
    if (role === 'swap') {
        if (!deployment.swap) throw new Error('swap not deployed yet')
        holderAddress = getAddress(deployment.swap)
    } else if (isAddress(role)) {
        holderAddress = getAddress(role)
    } else {
        walletId = walletIdFor(role)
        holderAddress = await getWalletAddress(walletId)
    }

    console.log(`Token (${tokenKey}):`, tokenAddress)
    console.log(`Holder (${role}):  `, holderAddress)

    if (tokenKey === 'plainToken') {
        const balance = await publicClient.readContract({
            address: tokenAddress as `0x${string}`,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [holderAddress],
        })
        const decimals = Number(deployment.plainTokenDecimals ?? 6)
        console.log('Balance (raw):  ', balance.toString())
        console.log('Balance (units):', formatUnits(balance as bigint, decimals))
        return
    }

    // Confidential token: read the encrypted handle then user-decrypt via the relayer.
    if (!walletId) {
        // For the swap pseudo-role we don't have a DFNS wallet that owns the balance
        // and the swap contract can't decrypt non-publicly-decryptable handles, so
        // user-decryption is impossible here. Bail with a helpful message.
        if (role === 'swap') {
            throw new Error(
                "Cannot user-decrypt swap's confidential balance: no DFNS wallet for the swap contract.",
            )
        }
        throw new Error(`No walletId resolved for role: ${role}`)
    }

    const abi = loadArtifact('ConfidentialToken').abi
    const handle = (await publicClient.readContract({
        address: tokenAddress as `0x${string}`,
        abi,
        functionName: 'confidentialBalanceOf',
        args: [holderAddress],
    })) as `0x${string}`
    console.log('Encrypted handle:', handle)
    if (/^0x0+$/.test(handle)) {
        console.log('Balance handle is zero — nothing to decrypt.')
        return
    }

    console.log('Initialising Zama relayer SDK (Sepolia)...')
    const fhevm = await createFhevmInstance()
    const keypair = fhevm.generateKeypair()
    const startTimestamp = Math.floor(Date.now() / 1000)
    const durationDays = 1

    const token = getAddress(tokenAddress)
    const eip712 = fhevm.createEIP712(keypair.publicKey, [token], startTimestamp, durationDays)
    const { EIP712Domain, ...nonDomainTypes } = eip712.types as any

    console.log('Requesting EIP-712 signature from DFNS...')
    const signature = await dfnsSignTypedData(dfnsApi, walletId, {
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
        console.log('Decrypted balance (units):', formatUnits(cleartext, 6))
    }
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
