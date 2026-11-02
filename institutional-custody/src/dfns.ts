import { DfnsApiClient, DfnsError } from '@dfns/sdk'
import { AsymmetricKeySigner } from '@dfns/sdk-keysigner'
// SDK 0.8.31 ships the vaults client but doesn't expose it on DfnsApiClient yet
import { VaultsClient } from '@dfns/sdk/generated/vaults/index.js'
import type { CreateVaultTransferResponse } from '@dfns/sdk/generated/vaults/types.js'
import { simpleFetch } from '@dfns/sdk/utils/fetch.js'
import { buildPathAndQuery } from '@dfns/sdk/utils/url.js'
import { env } from './env.js'

// One service account runs the custody backend for the demo. Approvers are
// separate: human users who decide with their passkeys, plus the checker, a
// second service account that can only read and vote on approvals. The
// checker must never share the backend's identity, or it would be voting on
// withdrawals it requested itself.
function clientOptions(prefix: 'DFNS' | 'CHECKER') {
    const credId = env(`${prefix}_CRED_ID`)
    // Allow the PEM to be stored on one line with literal \n in .env
    const privateKey = env(`${prefix}_PRIVATE_KEY`).replace(/\\n/g, '\n')
    return {
        orgId: env('DFNS_ORG_ID'),
        authToken: env(`${prefix}_AUTH_TOKEN`),
        baseUrl: env('DFNS_API_URL') || 'https://api.dfns.io',
        signer: new AsymmetricKeySigner({ credId, privateKey }),
    }
}

export const api = new DfnsApiClient(clientOptions('DFNS'))
export const vaults = new VaultsClient(clientOptions('DFNS'))
export const checkerApi = new DfnsApiClient(clientOptions('CHECKER'))

export function errorDetail(e: unknown) {
    if (e instanceof DfnsError) return { message: e.message, httpStatus: e.httpStatus, context: e.context }
    return { message: e instanceof Error ? e.message : String(e) }
}

// The same TransferRequest object the transfer endpoints return
export type TransferRequest = CreateVaultTransferResponse

// One item of List Vault History (GET /vaults/{vaultId}/history), typed from
// the API reference. Only the fields the backend reads are listed.
type HistoryBase = { id: string; vaultId: string; walletId: string; timestamp: string; network: string; tid: string; amount: string }
export type VaultHistoryItem =
    | HistoryBase & {
        kind: 'IncomingTransfer'
        status: 'Quarantined' | 'PendingPolicyApproval' | 'Released'
        quarantine: { id: string; transactionHash?: string; dateReleased?: string }
        incomingTransfer: { txHash: string; senders: string[]; asset?: { symbol?: string; decimals?: number } }
    }
    | HistoryBase & {
        kind: 'OutgoingTransfer'
        status: 'PendingPolicyApproval' | 'InProgress' | 'Confirmed' | 'Failed' | 'Rejected'
        transferRequest: TransferRequest
    }
    | HistoryBase & { kind: 'LockCreated' | 'LockDeleted'; lock: { id: string } }

// SDK 0.8.31 doesn't wrap List Vault History yet (0.8.33 does). This calls it
// through the SDK's own transport, exactly as the generated client calls List
// Vault Balances; with a newer SDK it becomes vaults.listVaultHistory(...).
export async function listVaultHistory(vaultId: string, query: { limit?: number; paginationToken?: string } = {}) {
    const path = buildPathAndQuery('/vaults/:vaultId/history', {
        path: { vaultId },
        query: { limit: query.limit?.toString(), paginationToken: query.paginationToken },
    })
    const response = await simpleFetch(path, { method: 'GET', apiOptions: clientOptions('DFNS') })
    return response.json() as Promise<{ items: VaultHistoryItem[]; nextPageToken?: string }>
}
