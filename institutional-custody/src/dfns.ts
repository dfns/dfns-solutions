import { DfnsApiClient } from '@dfns/sdk'
import { AsymmetricKeySigner } from '@dfns/sdk-keysigner'
// SDK 0.8.31 ships the vaults client but doesn't expose it on DfnsApiClient yet
import { VaultsClient } from '@dfns/sdk/generated/vaults/index.js'
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
