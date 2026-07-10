import { DfnsApiClient } from '@dfns/sdk'
import { AsymmetricKeySigner } from '@dfns/sdk-keysigner'
import { createPublicClient, http, defineChain, getAddress } from 'viem'
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type BroadcastOptions = {
    /** Block confirmations to wait for on the receipt (default 1). Use a higher
     *  value when a later tx depends on this one's state, to give DFNS's own
     *  estimation node time to catch up. */
    confirmations?: number
    /** How many times to re-submit if DFNS rejects the tx in pre-flight (default 3). */
    retries?: number
    retryDelayMs?: number
}

/**
 * Thrown when DFNS marks a transaction Failed/Rejected *before* broadcasting it —
 * i.e. it never produced a txHash. This is a pre-flight failure (gas estimation /
 * simulation), which is frequently transient: DFNS's node may not yet have seen a
 * dependency tx we just confirmed via a different RPC, so the simulation reads
 * stale state. Distinct from an on-chain revert, which always yields a txHash.
 */
class DfnsPreflightError extends Error {}

export async function broadcast(walletId: string, transaction: any, opts: BroadcastOptions = {}) {
    const { confirmations = 1, retries = 3, retryDelayMs = 6_000 } = opts

    for (let attempt = 0; ; attempt++) {
        console.log(`Broadcasting from ${walletId}...`)
        const result = await dfnsApi.wallets.broadcastTransaction({ walletId, body: transaction })

        let txHash: string
        try {
            // DFNS broadcastTransaction returns immediately with status "Pending" and
            // (usually) no txHash yet — the hash only appears once DFNS signs and
            // broadcasts. Poll getTransaction until the hash is set or it fails.
            txHash = await waitForDfnsTxHash(walletId, result.id, result.txHash)
        } catch (e) {
            if (e instanceof DfnsPreflightError && attempt < retries) {
                console.log(`  pre-flight rejected (${e.message}); retrying in ${retryDelayMs}ms...`)
                await sleep(retryDelayMs)
                continue
            }
            throw e
        }
        console.log('  tx hash:', txHash)

        const receipt = await publicClient.waitForTransactionReceipt({
            hash: txHash as `0x${string}`,
            confirmations,
        })
        if (receipt.status !== 'success') {
            throw new Error(`Tx reverted on-chain: ${txHash}`)
        }
        return receipt
    }
}

async function waitForDfnsTxHash(
    walletId: string,
    transactionId: string,
    initialHash?: string,
    { timeoutMs = 120_000, intervalMs = 2_000 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<string> {
    if (initialHash) return initialHash

    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const tx = await dfnsApi.wallets.getTransaction({ walletId, transactionId })
        if (tx.txHash) return tx.txHash
        if (tx.status === 'Failed' || tx.status === 'Rejected') {
            // No txHash => failed in pre-flight (estimation/simulation), often a
            // transient state-lag. Surface as retryable.
            throw new DfnsPreflightError(
                `DFNS tx ${transactionId} ${tx.status} pre-flight: ${tx.reason ?? 'no reason given'}`,
            )
        }
        await sleep(intervalMs)
    }
    throw new Error(`Timed out waiting for DFNS to broadcast transaction ${transactionId}`)
}

export async function getWalletAddress(walletId: string): Promise<`0x${string}`> {
    const w = await dfnsApi.wallets.getWallet({ walletId })
    if (!w.address) throw new Error(`Wallet ${walletId} has no address`)
    // DFNS returns addresses lowercased; the Zama relayer SDK requires an
    // EIP-55 checksummed address, so normalize here for all callers.
    return getAddress(w.address) as `0x${string}`
}

export function loadArtifact(name: string) {
    const p = path.join(__dirname, `../artifacts/contracts/${name}.sol/${name}.json`)
    return JSON.parse(fs.readFileSync(p, 'utf8'))
}

const DEPLOYMENT_FILE = path.join(__dirname, '../deployment.json')

export type Deployment = {
    plainToken?: string
    confSGD?: string
    confEUR?: string
    swap?: string
    [k: string]: any
}

export function saveDeployment(data: Deployment) {
    const existing = fs.existsSync(DEPLOYMENT_FILE)
        ? JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, 'utf8'))
        : {}
    fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify({ ...existing, ...data }, null, 2))
}

export function loadDeployment(): Deployment {
    if (!fs.existsSync(DEPLOYMENT_FILE)) {
        throw new Error('deployment.json not found — run the deploy scripts first')
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

export function walletIdFor(role: string): string {
    switch (role.toLowerCase()) {
        case 'bank':
            return BANK_WALLET_ID
        case 'sender':
            return SENDER_WALLET_ID
        case 'receiver':
            return RECEIVER_WALLET_ID
        default:
            throw new Error(`Unknown role: ${role}. Expected bank|sender|receiver`)
    }
}
