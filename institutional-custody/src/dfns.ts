import { DfnsApiClient } from '@dfns/sdk'
import { AsymmetricKeySigner } from '@dfns/sdk-keysigner'
// SDK 0.8.31 ships the vaults client but doesn't expose it on DfnsApiClient yet
import { VaultsClient } from '@dfns/sdk/generated/vaults/index.js'
import { env } from './env.js'

// One service account runs the custody backend for the demo. Approvers are
// separate human users: they decide with their passkeys, not this account.
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

export const api = new DfnsApiClient(clientOptions())
export const vaults = new VaultsClient(clientOptions())
