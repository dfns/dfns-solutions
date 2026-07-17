import { DfnsApiClient } from '@dfns/sdk'
import { AsymmetricKeySigner } from '@dfns/sdk-keysigner'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { createPublicClient, http } from 'viem'
import { sepolia } from 'viem/chains'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.join(__dirname, '..', '.env') })

if (!process.env.DFNS_CRED_ID) {
    throw new Error('DFNS_CRED_ID not found in .env')
}

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

// Wallet that holds the payroll funds and initiates transfers. Tag this wallet `payroll` in the Dfns dashboard.
export const TREASURY_WALLET_ID = process.env.TREASURY_WALLET_ID!

// User listed as human approver on the policy (alongside the service account).
export const POLICY_USER_ID = process.env.POLICY_USER_ID!

// Sepolia USDC contract — override via .env for other chains.
export const USDC_CONTRACT = (process.env.USDC_CONTRACT || '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238').toLowerCase()

// Transfers at or below this amount (in USDC, not base units) are auto-approved by the service account.
export const AUTO_APPROVE_LIMIT_USDC = Number(process.env.AUTO_APPROVE_LIMIT_USDC || '1000')

export const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(),
})
