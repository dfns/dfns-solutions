import { DfnsApiClient } from '@dfns/sdk'
import { AsymmetricKeySigner } from '@dfns/sdk-keysigner'
import { createPublicClient, http, defineChain } from 'viem'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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

const rpcUrl = process.env.BLOCKCHAIN_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'

const chain = defineChain({
    id: 1,
    name: 'Custom',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
        default: { http: [rpcUrl] },
    },
})

export const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
})
