import { DfnsApiClient } from '@dfns/sdk'
import { AsymmetricKeySigner } from '@dfns/sdk-keysigner'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.join(__dirname, '../.env') })

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
    baseUrl: process.env.DFNS_API_URL || 'https://api.dfns.io',
    signer,
})

export const ISSUER_WALLET_ID = process.env.ISSUER_WALLET_ID!
export const INVESTOR_WALLET_ID = process.env.INVESTOR_WALLET_ID!

const NETWORK = 'EthereumSepolia'

function findFunctionAbi(abi: any[], functionName: string) {
    const fn = abi.find((item: any) => item.type === 'function' && item.name === functionName)
    if (!fn) throw new Error(`Function "${functionName}" not found in ABI`)
    return fn
}

// DFNS's call-function endpoint wants args as an object keyed by the ABI
// input names, not a positional array (confirmed against the live API).
// Args are JSON-serialized over HTTP, so bigints (e.g. a coupon index) must
// be stringified first -- JSON.stringify can't handle a raw bigint.
function buildCalldata(fnAbi: any, args: any[]) {
    const calldata: Record<string, any> = {}
    fnAbi.inputs.forEach((input: any, i: number) => {
        const value = args[i]
        calldata[input.name || `arg${i}`] = typeof value === 'bigint' ? value.toString() : value
    })
    return calldata
}

// Reads a contract via DFNS's network passthrough instead of a raw RPC node.
// Numeric outputs come back as decimal strings (wrap with BigInt(...) before
// passing to viem helpers like formatUnits which require a real bigint).
export async function readContract({ address, abi, functionName, args = [] }: {
    address: string
    abi: any[]
    functionName: string
    args?: any[]
}) {
    const fnAbi = findFunctionAbi(abi, functionName)
    return dfnsApi.networks.callFunction({
        network: NETWORK,
        body: { contract: address, abi: fnAbi, calldata: buildCalldata(fnAbi, args) },
    })
}

async function waitForConfirmation(walletId: string, transactionId: string) {
    for (let i = 0; i < 150; i++) {
        const tx = await dfnsApi.wallets.getTransaction({ walletId, transactionId })
        if (tx.status === 'Confirmed') return tx
        if (tx.status === 'Failed' || tx.status === 'Rejected') {
            throw new Error(`Transaction ${tx.status}: ${tx.reason || transactionId}`)
        }
        await new Promise(r => setTimeout(r, 2000))
    }
    throw new Error('Transaction timed out waiting for confirmation')
}

// DFNS has no API that returns a deployment's resulting contract address
// (that would normally come from an RPC receipt's `contractAddress` field).
// A CREATE-address prediction based on a locally tracked nonce was tried and
// rejected: these wallets already have long transaction histories from other
// demos in this repo, so a nonce assumed from a fresh counter silently
// predicts the wrong address. There's no DFNS-only way to learn a wallet's
// real nonce either, so for deployments the caller must look up the address
// manually (e.g. via an Etherscan link built from the returned txHash) --
// matching how the CLI ops scripts already ask for contract addresses.
export async function broadcast(walletId: string, to: string | undefined, data: string) {
    const result = await dfnsApi.wallets.broadcastTransaction({
        walletId,
        body: { kind: 'Evm', to, data } as any,
    })

    const tx = await waitForConfirmation(walletId, result.id)

    return { txHash: tx.txHash!, fee: tx.fee, dateConfirmed: tx.dateConfirmed }
}
