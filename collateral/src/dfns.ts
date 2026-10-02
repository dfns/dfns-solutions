import { DfnsApiClient, DfnsError } from '@dfns/sdk'
import { AsymmetricKeySigner } from '@dfns/sdk-keysigner'
// SDK 0.8.31 ships the vaults client but doesn't expose it on DfnsApiClient yet
import { VaultsClient } from '@dfns/sdk/generated/vaults/index.js'
import { env } from './env.js'
import { record, type Actor } from './events.js'

// For the demo both actors share one service account (DFNS_* credentials).
// The borrower/lender clients are kept separate so each call is attributed to
// its actor. In production they would be separate identities: only the one
// that created a lock (the lender) can replace, release or transfer it, which
// is what keeps the borrower from pulling back pledged collateral.
function clientOptions() {
    const credId = env('DFNS_CRED_ID')
    // Allow the PEM to be stored on one line with literal \n in .env
    const privateKey = env('DFNS_PRIVATE_KEY').replace(/\\n/g, '\n')
    return {
        orgId: env('DFNS_ORG_ID'),
        authToken: env('DFNS_AUTH_TOKEN'),
        baseUrl: env('DFNS_API_URL') || 'https://api.dfns.io',
        signer: new AsymmetricKeySigner({ credId, privateKey }),
    }
}

export const borrowerApi = new DfnsApiClient(clientOptions())
export const lenderApi = new DfnsApiClient(clientOptions())
export const borrowerVaults = new VaultsClient(clientOptions())
export const lenderVaults = new VaultsClient(clientOptions())

export const ids = {
    get borrowerVault() { return env('BORROWER_VAULT_ID') },
    get lenderVault() { return env('LENDER_VAULT_ID') },
}

export function errorDetail(e: unknown) {
    if (e instanceof DfnsError) return { message: e.message, httpStatus: e.httpStatus, context: e.context }
    return { message: e instanceof Error ? e.message : String(e) }
}

// Runs one Dfns call and records it, with its request and response, on the
// UI timeline. Showing the raw API traffic is the point of the demo.
export async function call<T>(actor: Actor, title: string, request: unknown, fn: () => Promise<T>, loanId?: string): Promise<T> {
    try {
        const response = await fn()
        const txHash = (response as any)?.txHash
        record({ actor, kind: 'dfns', title, loanId, request, response, txHash })
        return response
    } catch (e) {
        record({ actor, kind: 'error', title: `${title} failed`, loanId, request, response: errorDetail(e) })
        throw e
    }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Wallet and vault transfers are asynchronous: poll until the transfer
// reaches a final state.
export async function waitForTransfer(api: DfnsApiClient, walletId: string, transferId: string, timeoutMs = 5 * 60_000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const t = await api.wallets.getTransfer({ walletId, transferId })
        if (t.status === 'Confirmed') return t
        if (t.status === 'Failed' || t.status === 'Rejected') {
            throw new Error(`Transfer ${transferId} ${t.status}${t.reason ? `: ${t.reason}` : ''}`)
        }
        await sleep(3000)
    }
    throw new Error(`Transfer ${transferId} not confirmed after ${timeoutMs / 1000}s`)
}

export function explorerTx(txHash?: string) {
    return txHash ? `https://sepolia.etherscan.io/tx/${txHash}` : undefined
}
