import { DfnsApiClient } from '@dfns/sdk'
import { AsymmetricKeySigner } from '@dfns/sdk-keysigner'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.join(__dirname, '.env') })

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
export const SOURCE_MINT = process.env.SOURCE_MINT!
export const TARGET_MINT = process.env.TARGET_MINT!
export const PROGRAM_ID = process.env.PROGRAM_ID || 'CEMoNh21BbxrVdPM6N9xwpqFHD8dxAFkBscZqPEdfrbe'
