import { DfnsApiClient } from '@dfns/sdk'
import { AsymmetricKeySigner } from '@dfns/sdk-keysigner'
import { createPublicClient, http, defineChain } from 'viem'
import { createInstance, SepoliaConfig } from '@zama-fhe/relayer-sdk/node'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

dotenv.config({ path: path.join(__dirname, '../.env') })

const signer = new AsymmetricKeySigner({
    credId: process.env.DFNS_CRED_ID!,
    privateKey: process.env.DFNS_PRIVATE_KEY!,
})

export const dfnsApi = new DfnsApiClient({
    orgId: process.env.DFNS_ORG_ID!,
    authToken: process.env.DFNS_AUTH_TOKEN!,
    baseUrl: process.env.DFNS_API_URL!,
    signer,
})

export const BANK_WALLET_ID = process.env.BANK_WALLET_ID!
export const SENDER_WALLET_ID = process.env.SENDER_WALLET_ID!
export const RECEIVER_WALLET_ID = process.env.RECEIVER_WALLET_ID!

const rpcUrl = process.env.BLOCKCHAIN_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'

export const SEPOLIA_CHAIN_ID = 11155111

const sepolia = defineChain({
    id: SEPOLIA_CHAIN_ID,
    name: 'Sepolia',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
})

export const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
})

export async function broadcast(walletId: string, transaction: any) {
    console.log(`Broadcasting from ${walletId}...`)
    const result = await dfnsApi.wallets.broadcastTransaction({
        walletId,
        body: transaction,
    })
    console.log('  tx hash:', result.txHash)
    const receipt = await publicClient.waitForTransactionReceipt({
        hash: result.txHash as `0x${string}`,
    })
    if (receipt.status !== 'success') {
        throw new Error(`Tx reverted: ${result.txHash}`)
    }
    return receipt
}

export async function getWalletAddress(walletId: string): Promise<`0x${string}`> {
    const w = await dfnsApi.wallets.getWallet({ walletId })
    return w.address as `0x${string}`
}

export function loadArtifact(name: string) {
    const p = path.join(__dirname, `../artifacts/contracts/${name}.sol/${name}.json`)
    return JSON.parse(fs.readFileSync(p, 'utf8'))
}

const DEPLOYMENT_FILE = path.join(__dirname, '../deployment.json')

export function saveDeployment(data: Record<string, string>) {
    fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(data, null, 2))
}

export function loadDeployment(): Record<string, string> {
    if (!fs.existsSync(DEPLOYMENT_FILE)) {
        throw new Error('deployment.json not found — run `npm run deploy` first')
    }
    return JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, 'utf8'))
}

export const toHex = (b: Uint8Array): `0x${string}` =>
    ('0x' + Buffer.from(b).toString('hex')) as `0x${string}`

export async function createFhevmInstance() {
    return createInstance({
        ...SepoliaConfig,
        network: rpcUrl,
    })
}

/**
 * Sign EIP-712 typed data via DFNS. Returns a 0x-prefixed signature.
 * Used for the user-decryption authorization required by the Zama relayer.
 */
export async function dfnsSignTypedData(
    walletId: string,
    typedData: {
        domain: Record<string, unknown>
        types: Record<string, { name: string; type: string }[]>
        message: Record<string, unknown>
        primaryType?: string
    },
): Promise<`0x${string}`> {
    const res = await dfnsApi.wallets.generateSignature({
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
