import { decodeAbiParameters, isHex } from 'viem'
import readline from 'readline'
import { client } from './dfns.js'
import { easAbi, EAS_ADDRESS } from './eas.js'

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = (q: string): Promise<string> => new Promise(resolve => rl.question(q, resolve))

async function main() {
    console.log('--- Verify Attestation ---')

    const uid = await ask('Attestation UID: ')
    rl.close()
    if (!isHex(uid) || uid.length !== 66) throw new Error('Invalid attestation UID (expected 32-byte hex string)')

    const isValid = await client.readContract({
        address: EAS_ADDRESS,
        abi: easAbi,
        functionName: 'isAttestationValid',
        args: [uid],
    })
    if (!isValid) {
        console.log('No attestation found for this UID.')
        return
    }

    const attestation = await client.readContract({
        address: EAS_ADDRESS,
        abi: easAbi,
        functionName: 'getAttestation',
        args: [uid],
    })

    const [contractAddress, isin, lei] = decodeAbiParameters(
        [
            { name: 'contractAddress', type: 'address' },
            { name: 'isin', type: 'string' },
            { name: 'lei', type: 'string' },
        ],
        attestation.data,
    )

    console.log('\nAttester:', attestation.attester)
    console.log('Recipient:', attestation.recipient)
    console.log('Revoked:', attestation.revocationTime !== 0n)
    console.log('Attested at:', new Date(Number(attestation.time) * 1000).toLocaleString())
    console.log('\nBond Contract Address:', contractAddress)
    console.log('ISIN:', isin)
    console.log('LEI:', lei)
}

main().catch(error => {
    console.error('Verification failed:', error)
    rl.close()
    process.exit(1)
})
