import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse, parseSecret, serialize, sign, verify, type ValidationGateReq } from '../gate/protocol.js'
import { decide, parseHours, withinHours, type GateConfig } from '../gate/rules.js'

const SECRET = parseSecret('11'.repeat(32))
const ALLOWED = '0xAbCdEf0000000000000000000000000000000001'
const config: GateConfig = {
    maxAmountWei: 1000n,
    allowlist: new Set([ALLOWED.toLowerCase()]),
    allowKeyExport: false,
    allowNoIntent: false,
    timeZone: 'UTC',
}
const signerInfo = { txHash: 'abcd', keyId: 'key-1', kind: 'Signing', publicKey: '0203' } as const
const transfer = (to: string, amount: string): ValidationGateReq => ({
    signerInfo,
    path: '/wallets/wa-aaa/transfers',
    payload: { kind: 'Native', to, amount },
    destinationAddress: to,
})

// Same vector as hmac_signature in validation-gate-core, base64 like the signer sends it
test('hmac matches the signer (base64 of HMAC-SHA256)', () => {
    assert.equal(sign(Buffer.from('abcd'), 'efgh'), 'wekLq2qFdqWFr//M7r9LCnRKsECQB43svPZjsIIb7aY=')
})

test('verify accepts the right signature on the raw body', () => {
    const body = Buffer.from(serialize(transfer(ALLOWED, '1')))
    assert.equal(verify(SECRET, body, sign(SECRET, body)), true)
})

test('verify rejects a missing, wrong, truncated or replayed signature', () => {
    const body = Buffer.from(serialize(transfer(ALLOWED, '1')))
    const good = sign(SECRET, body)
    assert.equal(verify(SECRET, body, undefined), false)
    assert.equal(verify(SECRET, body, ''), false)
    assert.equal(verify(SECRET, body, sign(parseSecret('22'.repeat(32)), body)), false)
    assert.equal(verify(SECRET, body, good.slice(0, 20)), false)
    // A valid signature from another body (amount changed in transit)
    assert.equal(verify(SECRET, Buffer.from(serialize(transfer(ALLOWED, '999999'))), good), false)
    // Whitespace changes the bytes, so the signature no longer matches
    assert.equal(verify(SECRET, Buffer.from(JSON.stringify(JSON.parse(body.toString()), null, 2)), good), false)
})

test('the secret must be 32 bytes of hex', () => {
    assert.throws(() => parseSecret('abcd'))
    assert.throws(() => parseSecret('zz'.repeat(32)))
    assert.equal(parseSecret('ab'.repeat(32)).length, 32)
})

// Same body as wire_keys_are_camel_case in validation-gate-core
test('serialize matches the signer byte for byte', () => {
    const body = serialize({
        signerInfo: { txHash: 'abcd', keyId: 'key-1', kind: 'Signing', publicKey: '0203', derivationPath: [44, 0], childPublicKey: '0405' },
        transaction: 'tx',
        path: '/wallets/wa-aaa/transfers',
        payload: { kind: 'Native', to: '0xto', amount: '1' },
        externalId: 'ext-1',
        userId: 'us-1',
        username: 'alice',
        sourceAddress: '0xfrom',
        destinationAddress: '0xto',
    })
    assert.equal(body, '{"signerInfo":{"txHash":"abcd","keyId":"key-1","kind":"Signing","publicKey":"0203","derivationPath":[44,0],"childPublicKey":"0405"},"transaction":"tx","path":"/wallets/wa-aaa/transfers","payload":{"kind":"Native","to":"0xto","amount":"1"},"externalId":"ext-1","userId":"us-1","username":"alice","sourceAddress":"0xfrom","destinationAddress":"0xto"}')
})

test('serialize skips absent fields, like the signer', () => {
    const body = serialize({ signerInfo: { keyId: 'key-1', kind: 'KeyExport', publicKey: '02' } })
    assert.equal(body, '{"signerInfo":{"keyId":"key-1","kind":"KeyExport","publicKey":"02"}}')
})

test('parse rejects malformed requests', () => {
    assert.equal(typeof parse(Buffer.from('not json')), 'string')
    assert.equal(typeof parse(Buffer.from('{}')), 'string')
    assert.equal(typeof parse(Buffer.from('{"signerInfo":{"keyId":"k","kind":"Other","publicKey":"02"}}')), 'string')
    assert.equal(typeof parse(Buffer.from('{"signerInfo":{"keyId":"k","kind":"Signing","publicKey":"xyz"}}')), 'string')
    assert.equal(typeof parse(Buffer.from('{"signerInfo":{"keyId":"k","kind":"Signing","publicKey":"02"},"payload":{"kind":"Native"}}')), 'string')
    assert.equal(typeof parse(Buffer.from(serialize(transfer(ALLOWED, '1')))), 'object')
})

test('approves a native transfer to an allowlisted address up to the cap', () => {
    assert.equal(decide(transfer(ALLOWED, '1000'), config).approved, true)
    // EVM addresses compare case-insensitively
    assert.equal(decide(transfer(ALLOWED.toLowerCase(), '1'), config).approved, true)
})

test('rejects over the cap, off the allowlist, or a non-native transfer', () => {
    assert.match(decide(transfer(ALLOWED, '1001'), config).reason, /over the cap/)
    assert.match(decide(transfer('0x0000000000000000000000000000000000000002', '1'), config).reason, /not on the allowlist/)
    const erc20 = transfer(ALLOWED, '1')
    erc20.payload!.kind = 'Erc20'
    assert.match(decide(erc20, config).reason, /only native/)
    assert.equal(decide(transfer(ALLOWED, '1e3'), config).approved, false)
})

test('rejects when the intent and destinationAddress disagree', () => {
    const req = { ...transfer(ALLOWED, '1'), destinationAddress: '0x0000000000000000000000000000000000000002' }
    assert.match(decide(req, config).reason, /differs/)
})

test('an empty allowlist rejects every destination', () => {
    assert.equal(decide(transfer(ALLOWED, '1'), { ...config, allowlist: new Set() }).approved, false)
})

test('key export is rejected unless allowed', () => {
    const req: ValidationGateReq = { signerInfo: { keyId: 'k', kind: 'KeyExport', publicKey: '02' } }
    assert.match(decide(req, config).reason, /key export/)
    assert.equal(decide(req, { ...config, allowKeyExport: true }).approved, true)
})

test('no intent is rejected unless allowed', () => {
    const req: ValidationGateReq = { signerInfo }
    assert.match(decide(req, config).reason, /no intent/)
    assert.equal(decide(req, { ...config, allowNoIntent: true }).approved, true)
})

test('business hours, including ranges across midnight and time zones', () => {
    const at = (iso: string) => new Date(iso)
    const day = parseHours('08-20')
    assert.equal(withinHours(day, 'UTC', at('2026-11-02T08:00:00Z')), true)
    assert.equal(withinHours(day, 'UTC', at('2026-11-02T19:59:00Z')), true)
    assert.equal(withinHours(day, 'UTC', at('2026-11-02T20:00:00Z')), false)
    assert.equal(withinHours(day, 'UTC', at('2026-11-02T07:59:00Z')), false)
    // 01:00 UTC is 09:00 in Singapore (UTC+8)
    assert.equal(withinHours(day, 'Asia/Singapore', at('2026-11-02T01:00:00Z')), true)
    const night = parseHours('22-06')
    assert.equal(withinHours(night, 'UTC', at('2026-11-02T23:00:00Z')), true)
    assert.equal(withinHours(night, 'UTC', at('2026-11-02T05:00:00Z')), true)
    assert.equal(withinHours(night, 'UTC', at('2026-11-02T12:00:00Z')), false)
    assert.equal(withinHours(undefined, 'UTC', at('2026-11-02T03:00:00Z')), true)
    assert.throws(() => parseHours('8h-20h'))
    assert.throws(() => parseHours('10-10'))
})

test('outside business hours rejects even a valid transfer', () => {
    const closed = { ...config, hours: parseHours('08-20') }
    assert.match(decide(transfer(ALLOWED, '1'), closed, new Date('2026-11-02T03:00:00Z')).reason, /business hours/)
    assert.equal(decide(transfer(ALLOWED, '1'), closed, new Date('2026-11-02T10:00:00Z')).approved, true)
})
