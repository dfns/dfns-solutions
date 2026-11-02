// The Validation Gate wire format, mirrored from Dfns's signer code
// (validation-gate-core in dfnsco/coresign). The signer POSTs a
// ValidationGateReq as JSON, HMAC-signed with a 32-byte shared secret, and
// signs only if the gate answers 200. Both the handler and the simulator use
// this file, so they can't drift apart.
import crypto from 'crypto'

export type RequestKind = 'Signing' | 'KeyExport'

// Trusted information the signer adds itself (not from the API caller)
export type SignerInfo = {
    txHash?: string // absent for key exports
    keyId: string
    kind: RequestKind
    publicKey: string // hex
    derivationPath?: number[]
    childPublicKey?: string // hex
}

// What the API request was trying to do, e.g. path /wallets/wa-.../transfers
export type Intent = {
    path: string
    payload: { kind: string; to: string; amount: string }
}

// The intent is flattened: `path` and `payload` sit at the top level
export type ValidationGateReq = {
    signerInfo: SignerInfo
    transaction?: string
    externalId?: string
    userId?: string
    username?: string
    sourceAddress?: string
    destinationAddress?: string
} & Partial<Intent>

export const SIGNATURE_HEADER = 'x-payload-signature'
export const SIGNATURE_TYPE_HEADER = 'x-payload-signature-type'
export const SIGNATURE_TYPE = 'hmac-sha256'

// The signer reads a denial's body as JSON only when Content-Type is exactly
// this value (a byte compare): "application/json; charset=utf-8" would be
// read as plain text.
export const CONTENT_TYPE = 'application/json'

// The signer approves on 200 only. Any other status denies the signature:
// 400 and 401 surface as Unauthenticated, everything else as PermissionDenied.
export const STATUS = { approved: 200, malformed: 400, badSignature: 401, rejected: 403 } as const

// Serializes in serde's field order, compact, so the bytes (and the HMAC) are
// the ones a real signer would send. Undefined fields are skipped, like
// serde's skip_serializing_if = "Option::is_none".
export function serialize(req: ValidationGateReq) {
    const { signerInfo: s } = req
    return JSON.stringify({
        signerInfo: {
            txHash: s.txHash,
            keyId: s.keyId,
            kind: s.kind,
            publicKey: s.publicKey,
            derivationPath: s.derivationPath,
            childPublicKey: s.childPublicKey,
        },
        transaction: req.transaction,
        path: req.path,
        payload: req.payload && { kind: req.payload.kind, to: req.payload.to, amount: req.payload.amount },
        externalId: req.externalId,
        userId: req.userId,
        username: req.username,
        sourceAddress: req.sourceAddress,
        destinationAddress: req.destinationAddress,
    })
}

// The signer config takes the secret as 32 raw bytes; .env holds it as hex
export function parseSecret(hex: string) {
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('GATE_SHARED_SECRET must be 32 bytes as 64 hex characters (openssl rand -hex 32)')
    return Buffer.from(hex, 'hex')
}

// HMAC-SHA256 of the raw body, base64 (standard alphabet, with padding)
export function sign(secret: Buffer, body: string | Buffer) {
    return crypto.createHmac('sha256', secret).update(body).digest('base64')
}

// Checks the signature header against the raw body, in constant time
export function verify(secret: Buffer, body: Buffer, signature: string | undefined) {
    if (!signature) return false
    const expected = Buffer.from(sign(secret, body), 'base64')
    const given = Buffer.from(signature, 'base64')
    // timingSafeEqual throws on a length mismatch; a wrong length is a bad signature
    return given.length === expected.length && crypto.timingSafeEqual(given, expected)
}

// Parses and shape-checks a request body. Returns an error string instead of
// throwing, so the handler can answer 400 with it.
export function parse(body: Buffer): ValidationGateReq | string {
    let req: any
    try {
        req = JSON.parse(body.toString('utf8'))
    } catch {
        return 'body is not JSON'
    }
    const s = req?.signerInfo
    if (!s || typeof s !== 'object') return 'missing signerInfo'
    if (typeof s.keyId !== 'string') return 'missing signerInfo.keyId'
    if (s.kind !== 'Signing' && s.kind !== 'KeyExport') return `unknown signerInfo.kind: ${s.kind}`
    if (typeof s.publicKey !== 'string' || !/^[0-9a-fA-F]*$/.test(s.publicKey)) return 'signerInfo.publicKey must be hex'
    if (req.payload !== undefined) {
        const p = req.payload
        if (typeof req.path !== 'string' || typeof p?.kind !== 'string' || typeof p?.to !== 'string' || typeof p?.amount !== 'string') {
            return 'intent must have path and payload { kind, to, amount }'
        }
    }
    return req as ValidationGateReq
}
