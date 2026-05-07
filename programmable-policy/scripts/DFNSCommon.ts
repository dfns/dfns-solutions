import { DfnsApiClient } from '@dfns/sdk'
import { AsymmetricKeySigner } from '@dfns/sdk-keysigner'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from blueprint root (parent of scripts/)
dotenv.config({ path: path.join(__dirname, '..', '.env') })

if (!process.env.DFNS_CRED_ID) {
    throw new Error("DFNS_CRED_ID not found in .env");
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

// Wallet ID used to broadcast transactions (the "Maker")
export const SENDER_WALLET_ID = process.env.SENDER_WALLET_ID!;

// User ID listed as approver on the policy
export const POLICY_USER_ID = process.env.POLICY_USER_ID!;

// Smart contract the service account is allowed to validate calls against
export const CONTRACT_ADDRESS = (process.env.CONTRACT_ADDRESS || '').toLowerCase();

// Address that the service account allows as the `mint` recipient
export const WHITELIST_ADDRESS = (process.env.WHITELIST_ADDRESS || '').toLowerCase();

// Public Client for reading from chain
export const client = createPublicClient({
    chain: sepolia,
    transport: http(),
})
