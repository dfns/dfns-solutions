/**
 * Gate a DFNS service account with DFNS' own policy engine.
 *
 * The service account's credential private key is a DFNS MPC key (EdDSA/ed25519).
 * Every User Action Signature the account needs is therefore produced by
 * POST /keys/{keyId}/signatures, which a Wallets:Sign policy gates behind an
 * approval quorum. The account holds a bearer token but cannot mutate anything
 * until the quorum releases the MPC signature.
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

import { createPublicKey, createSign, verify as cryptoVerify } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`missing env var ${name}`)
  return v
}

const API = must('DFNS_API_URL').replace(/\/+$/, '')
const ADMIN_TOKEN = must('DFNS_AUTH_TOKEN')
const ADMIN_CRED_ID = must('DFNS_CRED_ID')
const ADMIN_PRIVATE_KEY = must('DFNS_PRIVATE_KEY')

const RUN = `gated-sa-${Date.now().toString(36)}`
const TAG = `policy:${RUN}`

const b64url = (data: Buffer | string): string => Buffer.from(data as never).toString('base64url')
const hexBuf = (hex: string): Buffer => Buffer.from(hex.replace(/^0x/, ''), 'hex')
const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const csv = (name: string): string[] =>
  (process.env[name] ?? '').split(',').map((s) => s.trim()).filter(Boolean)

interface ApiOpts {
  method?: string
  token: string
  userAction?: string
  /** Pre-serialized JSON body. Must be byte-identical to the userActionPayload it was signed over. */
  rawBody?: string
}

async function api(path: string, opts: ApiOpts): Promise<any> {
  const method = opts.method ?? (opts.rawBody !== undefined ? 'POST' : 'GET')
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${opts.token}`,
      ...(opts.userAction ? { 'x-dfns-useraction': opts.userAction } : {}),
      ...(opts.rawBody !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: opts.rawBody,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 600)}`)
  return text ? JSON.parse(text) : undefined
}

async function initChallenge(token: string, method: string, path: string, payload: string): Promise<any> {
  return api('/auth/action/init', {
    token,
    rawBody: JSON.stringify({
      userActionPayload: payload,
      userActionHttpMethod: method,
      userActionHttpPath: path,
    }),
  })
}

/** Complete a full User Action Signing round as the admin (Key credential). */
async function adminUserAction(method: string, path: string, payload: string): Promise<string> {
  const challenge = await initChallenge(ADMIN_TOKEN, method, path, payload)
  // Keys in alphabetical order; JSON.stringify preserves insertion order.
  const clientData = JSON.stringify({ challenge: challenge.challenge, type: 'key.get' })
  const signature = createSign('SHA256').update(clientData).end().sign(ADMIN_PRIVATE_KEY)
  const res = await api('/auth/action', {
    token: ADMIN_TOKEN,
    rawBody: JSON.stringify({
      challengeIdentifier: challenge.challengeIdentifier,
      firstFactor: {
        kind: 'Key',
        credentialAssertion: {
          credId: ADMIN_CRED_ID,
          clientData: b64url(clientData),
          signature: b64url(signature),
        },
      },
    }),
  })
  return res.userAction
}

async function adminMutate(method: string, path: string, body?: unknown): Promise<any> {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const userAction = await adminUserAction(method, path, payload)
  return api(path, { method, token: ADMIN_TOKEN, userAction, rawBody: body === undefined ? undefined : payload })
}

/** Raw 32-byte ed25519 public key (hex) to the SPKI PEM POST /auth/service-accounts expects. */
function ed25519HexToPem(hex: string): string {
  const raw = hexBuf(hex)
  if (raw.length !== 32) throw new Error(`expected 32-byte ed25519 public key, got ${raw.length} bytes`)
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw])
  const lines = spki.toString('base64').match(/.{1,64}/g)!.join('\n')
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----\n`
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

async function setup(): Promise<void> {
  log(`run id: ${RUN}, api: ${API}`)

  log('1. create EdDSA/ed25519 key')
  const key = await adminMutate('POST', '/keys', { scheme: 'EdDSA', curve: 'ed25519', name: `${RUN}-key` })
  log(`   key: ${key.id} (${key.scheme}/${key.curve})`)

  log('2. create tagged proxy wallet from the key')
  const proxy = await adminMutate('POST', '/wallets', {
    network: 'SolanaDevnet',
    name: `${RUN}-policy-anchor`,
    signingKey: { id: key.id },
    tags: [TAG],
  })
  log(`   wallet: ${proxy.id} tags=[${TAG}]`)

  log('3. create quorum policy scoped to the tag')
  const policy = await adminMutate('POST', '/v2/policies', {
    name: `${RUN}-quorum`,
    activityKind: 'Wallets:Sign',
    rule: { kind: 'AlwaysTrigger', configuration: {} },
    action: {
      kind: 'RequestApproval',
      autoRejectTimeout: 10,
      approvalGroups: [buildApprovalGroup()],
    },
    filters: { walletTags: { hasAny: [TAG] } },
  })
  log(`   policy: ${policy.id} status=${policy.status}`)
  if (policy.status !== 'Active') {
    throw new Error(`policy not Active (a Policies:Modify policy may be gating creation): ${JSON.stringify(policy).slice(0, 300)}`)
  }

  log('4. create minimal permission for the gated service account')
  const permission = await adminMutate('POST', '/permissions', {
    name: `${RUN}-perm`,
    operations: ['Wallets:Create', 'Wallets:Read'],
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
  const saToken = must('GATED_SA_TOKEN')
  const autoApprove = (process.env.AUTO_APPROVE ?? 'true') === 'true'
  log(`run id: ${state.run}, api: ${API}, key: ${state.keyId}`)

  log('1. service account: init a user-action challenge for POST /wallets')
  const walletPayload = JSON.stringify({ network: 'SolanaDevnet', name: `${state.run}-proof-of-gate` })
  const tChallenge = Date.now()
  const ch = await initChallenge(saToken, 'POST', '/wallets', walletPayload)
  const saCredId: string = ch.allowCredentials.key[0].id
  log(`   challenge received, credId=${saCredId}`)

  log('2. request the MPC signature over the client data (the gated moment)')
  const clientData = JSON.stringify({ challenge: ch.challenge, type: 'key.get' })
  const sigReq = await adminMutate('POST', `/keys/${state.keyId}/signatures`, {
    kind: 'Message',
    message: '0x' + Buffer.from(clientData).toString('hex'),
  })
  log(`   signature request: ${sigReq.id} status=${sigReq.status} approvalId=${sigReq.approvalId ?? 'NONE'}`)
  if (sigReq.status !== 'Pending' || !sigReq.approvalId) {
    throw new Error(`the policy did not gate the signature (status=${sigReq.status}); check the policy and wallet tag`)
  }

  if (autoApprove) {
    log('3. cast the quorum vote as the admin identity (AUTO_APPROVE=true)')
    const approval = await adminMutate('POST', `/v2/policy-approvals/${sigReq.approvalId}/decisions`, {
      value: 'Approved',
      reason: 'automated demo vote',
    })
    log(`   approval status: ${approval.status}`)
  } else {
    log(`3. waiting for the quorum to approve ${sigReq.approvalId} in the dashboard...`)
  }

  log('4. poll the signature until it is Signed')
  let sig: any
  for (let i = 0; i < 150; i++) {
    sig = await api(`/keys/${state.keyId}/signatures/${sigReq.id}`, { token: ADMIN_TOKEN })
    if (sig.status === 'Signed') break
    if (sig.status === 'Rejected' || sig.status === 'Failed') {
      throw new Error(`signature ${sig.status}: ${JSON.stringify(sig).slice(0, 300)}`)
    }
    await sleep(4000)
  }
  if (sig.status !== 'Signed') throw new Error(`signature still ${sig.status} after timeout`)

  const rawSig = Buffer.concat([hexBuf(sig.signature.r), hexBuf(sig.signature.s)])
  const localOk = cryptoVerify(null, Buffer.from(clientData), createPublicKey(state.publicKeyPem), rawSig)
  log(`   signed. local ed25519 verification against the registered public key: ${localOk}`)
  if (!localOk) throw new Error('the MPC signature does not verify against the registered public key')

  log('5. service account: complete /auth/action with the MPC signature')
  const action = await api('/auth/action', {
    token: saToken,
    rawBody: JSON.stringify({
      challengeIdentifier: ch.challengeIdentifier,
      firstFactor: {
        kind: 'Key',
        credentialAssertion: {
          credId: saCredId,
          clientData: b64url(clientData),
          signature: b64url(rawSig),
        },
      },
    }),
  })
  log(`   user-action token obtained. challenge-to-assertion latency: ${((Date.now() - tChallenge) / 1000).toFixed(1)}s`)

  log('6. service account: perform the privileged call with the gated user action')
  const proof = await api('/wallets', { method: 'POST', token: saToken, userAction: action.userAction, rawBody: walletPayload })
  log(`   proof wallet created by the gated service account: ${proof.id} (${proof.network})`)

  log('SUCCESS: the full gated round-trip completed')
  console.log(JSON.stringify({ ...state, publicKeyPem: undefined, proofWalletId: proof.id }, null, 2))
}

async function cleanup(): Promise<void> {
  const state = loadState()
  try {
    await adminMutate('DELETE', `/v2/policies/${state.policyId}`)
    log(`cleanup: policy ${state.policyId} archived`)
  } catch (e) {
    log(`cleanup WARNING: policy ${state.policyId}: ${(e as Error).message.slice(0, 200)}`)
  }
  try {
    await adminMutate('PUT', `/permissions/${state.permissionId}/archive`, { isArchived: true })
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
