import { decodeEventLog, encodeAbiParameters, encodeFunctionData, isAddress, zeroHash } from 'viem'
import readline from 'readline'
import { dfnsApi, ISSUER_WALLET_ID, client } from './dfns.js'
import { easAbi, EAS_ADDRESS } from './eas.js'

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = (q: string): Promise<string> => new Promise(resolve => rl.question(q, resolve))

async function main() {
    console.log('--- Attest Bond Address <-> ISIN <-> LEI ---')

    const schemaUid = process.env.SCHEMA_UID
    if (!schemaUid) throw new Error('SCHEMA_UID not found in .env -- run `npm run register:schema` first')

    const wallet = await dfnsApi.wallets.getWallet({ walletId: ISSUER_WALLET_ID })
    console.log(`Attesting from: ${wallet.address}`)

    const contractAddress = await ask('Bond Contract Address: ')
    if (!isAddress(contractAddress)) throw new Error('Invalid contract address')

    const isin = await ask('ISIN: ')
    if (!isin) throw new Error('ISIN is required')

    const lei = await ask('LEI: ')
    if (!lei) throw new Error('LEI is required')

    rl.close()

    const encodedData = encodeAbiParameters(
        [
            { name: 'contractAddress', type: 'address' },
            { name: 'isin', type: 'string' },
            { name: 'lei', type: 'string' },
        ],
        [contractAddress, isin, lei],
    )

    const data = encodeFunctionData({
        abi: easAbi,
        functionName: 'attest',
        args: [
            {
                schema: schemaUid as `0x${string}`,
                data: {
                    recipient: contractAddress,
                    expirationTime: 0n,
                    revocable: true,
                    refUID: zeroHash,
                    data: encodedData,
                    value: 0n,
                },
            },
        ],
    })

    console.log('Broadcasting attestation...')
    const result = await dfnsApi.wallets.broadcastTransaction({
        walletId: ISSUER_WALLET_ID,
        body: { kind: 'Evm', to: EAS_ADDRESS, data } as any,
    })

    console.log('Tx hash:', result.txHash)
    if (!result.txHash) {
        console.log('Transaction pending approval. ID:', result.id)
        return
    }

    const receipt = await client.waitForTransactionReceipt({ hash: result.txHash as `0x${string}` })

    for (const log of receipt.logs) {
        try {
            const decoded = decodeEventLog({ abi: easAbi, data: log.data, topics: log.topics })
            if (decoded.eventName === 'Attested') {
                console.log('Attestation UID:', decoded.args.uid)
                console.log(`View at: https://sepolia.easscan.org/attestation/view/${decoded.args.uid}`)
                return
            }
        } catch {
            // not the event we're looking for, skip
        }
    }

    console.log('Attested, but could not find the Attested event in the receipt logs.')
}

main().catch(error => {
    console.error('Attestation failed:', error)
    rl.close()
    process.exit(1)
})
