/**
 * Gate a DFNS service account with DFNS' own policy engine.
 *
 * The service account's credential private key is a DFNS MPC key (EdDSA/ed25519).
 * Every User Action Signature the account needs is therefore produced by
 * POST /keys/{keyId}/signatures, which a Wallets:Sign policy gates behind an
 * approval quorum. The account holds a bearer token but cannot mutate anything
 * until the quorum releases the MPC signature.
 *
 * The whole gate lives in one place: GatedKeySigner, a CredentialSigner for the
 * DfnsApiClient. The gated client is used like any other SDK client — every
 * user action it signs transparently routes through the quorum-held MPC key.
 *
 * The flow is split into phases around one manual dashboard step, because
 * POST /auth/service-accounts is not accepted with a service-account or PAT
 * token (it needs an interactive session):
 *
 *   npm run setup      # create key, proxy wallet, policy, permission; print the PEM
 *   --- create the service account in the dashboard with that public key ---
 *   npm run go         # the gated round-trip (challenge -> gated signature -> proof)
 *   npm run cleanup    # archive the policy and permission
 *
 * Admin env (see .env.example): DFNS_API_URL, DFNS_AUTH_TOKEN, DFNS_CRED_ID,
 * DFNS_PRIVATE_KEY. Use a development organization. No secrets are printed.
 */

import 'dotenv/config'

import { createPublicKey, verify as cryptoVerify } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

import { DfnsApiClient } from '@dfns/sdk'
import type { CredentialSigner, KeyAssertion, UserActionChallenge } from '@dfns/sdk'
import { AsymmetricKeySigner } from '@dfns/sdk-keysigner'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`missing env var ${name}`)
  return v
}

const API = must('DFNS_API_URL').replace(/\/+$/, '')

const RUN = `gated-sa-${Date.now().toString(36)}`
const TAG = `policy:${RUN}`

const b64url = (data: Buffer): string => data.toString('base64url')
const hexBuf = (hex: string): Buffer => Buffer.from(hex.replace(/^0x/, ''), 'hex')
const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const csv = (name: string): string[] =>
  (process.env[name] ?? '').split(',').map((s) => s.trim()).filter(Boolean)

/**
 * The admin identity (a PAT with a plain Key credential). It plays the
 * "operator" role: it may request MPC signatures (Keys:Signatures:Create) and,
 * in this demo, casts the quorum vote. In production the operator is typically
 * a dedicated service account with only Keys:Signatures:Create, and the voters
 * are humans in the dashboard.
 */
const admin = new DfnsApiClient({
  baseUrl: API,
  authToken: must('DFNS_AUTH_TOKEN'),
  signer: new AsymmetricKeySigner({
    credId: must('DFNS_CRED_ID'),
    privateKey: must('DFNS_PRIVATE_KEY'),
  }),
})

/**
 * The gate, packaged as a CredentialSigner.
 *
 * The DfnsApiClient calls sign(challenge) whenever the gated service account
 * needs a User Action Signature. Instead of signing locally, this signer asks
 * the operator to run the challenge through the quorum-held MPC key:
 *
 *   operator: POST /keys/{keyId}/signatures  -> Pending + approvalId (policy)
 *   quorum:   approves in the dashboard (or the demo auto-vote)
 *   operator: polls until Signed, returns the assertion
 *
 * The service account's registered public key IS the MPC key's public key, so
 * the returned signature is a valid credential assertion for the challenge.
 */
type GatedKeySignerOptions = {
  keyId: string
  /** non-gated identity holding Keys:Signatures:Create */
  operator: DfnsApiClient
  /** demo convenience: the operator votes; set false to approve in the dashboard */
  autoApprove: boolean
  /** registered SPKI PEM, to verify the MPC signature locally before use */
  publicKeyPem?: string
}

class GatedKeySigner implements CredentialSigner<KeyAssertion> {
  private options: GatedKeySignerOptions

  constructor(options: GatedKeySignerOptions) {
    this.options = options
  }

  async sign(challenge: UserActionChallenge): Promise<KeyAssertion> {
    const { keyId, operator, autoApprove, publicKeyPem } = this.options

    // Same clientData layout the SDK's own signers produce.
    const clientData = Buffer.from(JSON.stringify({ type: 'key.get', challenge: challenge.challenge }))

    log('   gate: request the MPC signature over the client data (the gated moment)')
    const sigReq = await operator.keys.generateSignature({
      keyId,
      body: { kind: 'Message', message: `0x${clientData.toString('hex')}` },
    })
    log(`   gate: signature request ${sigReq.id} status=${sigReq.status} approvalId=${sigReq.approvalId ?? 'NONE'}`)
    if (sigReq.status !== 'Pending' || !sigReq.approvalId) {
      throw new Error(`the policy did not gate the signature (status=${sigReq.status}); check the policy and wallet tag`)
    }

    if (autoApprove) {
      log('   gate: cast the quorum vote as the admin identity (AUTO_APPROVE=true)')
      const approval = await operator.policies.createApprovalDecision({
        approvalId: sigReq.approvalId,
        body: { value: 'Approved', reason: 'automated demo vote' },
      })
      log(`   gate: approval status ${approval.status}`)
    } else {
      log(`   gate: waiting for the quorum to approve ${sigReq.approvalId} in the dashboard...`)
    }

    let sig: Awaited<ReturnType<typeof operator.keys.getSignature>> | undefined
    for (let i = 0; i < 150; i++) {
      sig = await operator.keys.getSignature({ keyId, signatureId: sigReq.id })
      if (sig.status === 'Signed') break
      if (sig.status === 'Rejected' || sig.status === 'Failed') {
        throw new Error(`signature ${sig.status}: ${JSON.stringify(sig).slice(0, 300)}`)
      }
      await sleep(4000)
    }
    if (!sig || sig.status !== 'Signed' || !sig.signature) {
      throw new Error(`signature still ${sig?.status} after timeout`)
    }

    const rawSig = Buffer.concat([hexBuf(sig.signature.r), hexBuf(sig.signature.s)])
    if (publicKeyPem) {
      const ok = cryptoVerify(null, clientData, createPublicKey(publicKeyPem), rawSig)
      log(`   gate: local ed25519 verification against the registered public key: ${ok}`)
      if (!ok) throw new Error('the MPC signature does not verify against the registered public key')
    }

    return {
      kind: 'Key',
      credentialAssertion: {
        credId: challenge.allowCredentials.key[0].id,
        clientData: b64url(clientData),
        signature: b64url(rawSig),
      },
    }
  }
}

/** Build the approval group from env, folding in the rule that service-account
 *  approvers must be listed explicitly and have serviceAccountsCanApprove set. */
function buildApprovalGroup(): Record<string, unknown> {
  const quorum = Number(process.env.QUORUM ?? 1)
  const approverIds = csv('APPROVER_USER_IDS')
  const initiatorCanApprove = (process.env.INITIATOR_CAN_APPROVE ?? 'true') === 'true'
  const serviceAccountsCanApprove = (process.env.SERVICE_ACCOUNT_APPROVERS ?? 'false') === 'true'

  const group: Record<string, unknown> = {
    quorum,
    initiatorCanApprove,
    approvers: approverIds.length ? { userId: { in: approverIds } } : {},
  }
  if (serviceAccountsCanApprove) {
    if (!approverIds.length) {
      throw new Error('SERVICE_ACCOUNT_APPROVERS=true requires APPROVER_USER_IDS to be set explicitly')
    }
    group.serviceAccountsCanApprove = true
  }
  return group
}

const STATE_FILE = new URL('./state.json', import.meta.url).pathname
type State = {
  run: string
  tag: string
  keyId: string
  publicKeyPem: string
  proxyWalletId: string
  policyId: string
  permissionId: string
}
const loadState = (): State => JSON.parse(readFileSync(STATE_FILE, 'utf8'))

/** Raw 32-byte ed25519 public key (hex) to the SPKI PEM POST /auth/service-accounts expects. */
function ed25519HexToPem(hex: string): string {
  const raw = hexBuf(hex)
  if (raw.length !== 32) throw new Error(`expected 32-byte ed25519 public key, got ${raw.length} bytes`)
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw])
  const lines = spki.toString('base64').match(/.{1,64}/g)!.join('\n')
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----\n`
}

async function setup(): Promise<void> {
  log(`run id: ${RUN}, api: ${API}`)

  log('1. create EdDSA/ed25519 key')
  const key = await admin.keys.createKey({
    body: { scheme: 'EdDSA', curve: 'ed25519', name: `${RUN}-key` },
  })
  log(`   key: ${key.id} (${key.scheme}/${key.curve})`)

  log('2. create tagged proxy wallet from the key')
  const proxy = await admin.wallets.createWallet({
    body: {
      network: 'SolanaDevnet',
      name: `${RUN}-policy-anchor`,
      signingKey: { id: key.id },
      tags: [TAG],
    },
  })
  log(`   wallet: ${proxy.id} tags=[${TAG}]`)

  log('3. create quorum policy scoped to the tag')
  const policy = await admin.policies.createPolicy({
    body: {
      name: `${RUN}-quorum`,
      activityKind: 'Wallets:Sign',
      rule: { kind: 'AlwaysTrigger', configuration: {} },
      action: {
        kind: 'RequestApproval',
        autoRejectTimeout: 10,
        approvalGroups: [buildApprovalGroup()],
      },
      filters: { walletTags: { hasAny: [TAG] } },
    } as never,
  })
  log(`   policy: ${policy.id} status=${policy.status}`)
  if (policy.status !== 'Active') {
    throw new Error(`policy not Active (a Policies:Modify policy may be gating creation): ${JSON.stringify(policy).slice(0, 300)}`)
  }

  log('4. create minimal permission for the gated service account')
  const permission = await admin.permissions.createPermission({
    body: { name: `${RUN}-perm`, operations: ['Wallets:Create', 'Wallets:Read'] },
  })
  log(`   permission: ${permission.id}`)

  const pem = ed25519HexToPem(key.publicKey)
  const state: State = {
    run: RUN,
    tag: TAG,
    keyId: key.id,
    publicKeyPem: pem,
    proxyWalletId: proxy.id,
    policyId: policy.id,
    permissionId: permission.id,
  }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  log(`state written to ${STATE_FILE}`)

  console.log('\n--- MANUAL STEP: create the service account in the dashboard ---')
  console.log(`Settings -> Service Accounts -> New, name it "${RUN}-sa",`)
  console.log(`assign permission "${RUN}-perm", and paste this public key:\n`)
  console.log(pem)
  console.log('Save the access token it shows once into .env as GATED_SA_TOKEN, then run: npm run go\n')
}

async function go(): Promise<void> {
  const state = loadState()
  const autoApprove = (process.env.AUTO_APPROVE ?? 'true') === 'true'
  log(`run id: ${state.run}, api: ${API}, key: ${state.keyId}`)

  // The gated client: a normal DfnsApiClient whose signer routes every user
  // action through the quorum-held MPC key. Nothing downstream knows the gate
  // exists — this one construction is the entire integration.
  const sa = new DfnsApiClient({
    baseUrl: API,
    authToken: must('GATED_SA_TOKEN'),
    signer: new GatedKeySigner({
      keyId: state.keyId,
      operator: admin,
      autoApprove,
      publicKeyPem: state.publicKeyPem,
    }),
  })

  log('1. service account: create a wallet (the SDK runs the gated user action underneath)')
  const tStart = Date.now()
  const proof = await sa.wallets.createWallet({
    body: { network: 'SolanaDevnet', name: `${state.run}-proof-of-gate` },
  })
  log(`   proof wallet created by the gated service account: ${proof.id} (${proof.network})`)
  log(`   challenge-to-proof latency: ${((Date.now() - tStart) / 1000).toFixed(1)}s`)

  log('SUCCESS: the full gated round-trip completed')
  console.log(JSON.stringify({ ...state, publicKeyPem: undefined, proofWalletId: proof.id }, null, 2))
}

async function cleanup(): Promise<void> {
  const state = loadState()
  try {
    await admin.policies.archivePolicy({ policyId: state.policyId })
    log(`cleanup: policy ${state.policyId} archived`)
  } catch (e) {
    log(`cleanup WARNING: policy ${state.policyId}: ${(e as Error).message.slice(0, 200)}`)
  }
  try {
    await admin.permissions.archivePermission({
      permissionId: state.permissionId,
      body: { isArchived: true },
    })
    log(`cleanup: permission ${state.permissionId} archived`)
  } catch (e) {
    log(`cleanup WARNING: permission ${state.permissionId}: ${(e as Error).message.slice(0, 200)}`)
  }
  log('note: deactivate the service account from the dashboard (a PAT cannot manage service accounts)')
}

const phase = process.argv[2] ?? 'setup'
const phases: Record<string, () => Promise<void>> = { setup, go, cleanup }
if (!phases[phase]) {
  console.error(`unknown phase "${phase}"; use setup | go | cleanup`)
  process.exit(2)
}
phases[phase]().catch((e) => {
  console.error(`FAILED: ${(e as Error).message}`)
  process.exit(1)
})
