import { decodeEventLog, encodeFunctionData, zeroAddress } from 'viem'
import { dfnsApi, ISSUER_WALLET_ID, client } from './dfns.js'
import { schemaRegistryAbi, SCHEMA_REGISTRY_ADDRESS, BOND_SCHEMA } from './eas.js'

async function main() {
    console.log('--- Register Bond Attestation Schema ---')
    console.log('Schema:', BOND_SCHEMA)

    const wallet = await dfnsApi.wallets.getWallet({ walletId: ISSUER_WALLET_ID })
    console.log(`Registering from: ${wallet.address}`)

    const data = encodeFunctionData({
        abi: schemaRegistryAbi,
        functionName: 'register',
        args: [BOND_SCHEMA, zeroAddress, true],
    })

    console.log('Broadcasting registration...')
    const result = await dfnsApi.wallets.broadcastTransaction({
        walletId: ISSUER_WALLET_ID,
        body: { kind: 'Evm', to: SCHEMA_REGISTRY_ADDRESS, data } as any,
    })

    console.log('Tx hash:', result.txHash)
    if (!result.txHash) {
        console.log('Transaction pending approval. ID:', result.id)
        return
    }

    const receipt = await client.waitForTransactionReceipt({ hash: result.txHash as `0x${string}` })

    for (const log of receipt.logs) {
        try {
            const decoded = decodeEventLog({ abi: schemaRegistryAbi, data: log.data, topics: log.topics })
            if (decoded.eventName === 'Registered') {
                console.log('Schema UID:', decoded.args.uid)
                console.log('\nAdd this to your .env as SCHEMA_UID')
                return
            }
        } catch {
            // not the event we're looking for, skip
        }
    }

    console.log('Registered, but could not find the Registered event in the receipt logs.')
}

main().catch(error => {
    console.error('Schema registration failed:', error)
    process.exit(1)
})
