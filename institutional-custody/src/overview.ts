// Read-only views for the walkthrough page: the controls in place, the
// Validation Gate's recent decisions and how an approval was decided. Nothing
// here returns a secret: IDs, rules and decisions only.
import { api, errorDetail } from './dfns.js'
import { env } from './env.js'
import { state } from './poller.js'

const TAG = 'custody-demo'

type Policy = Awaited<ReturnType<typeof api.policies.getPolicy>>

// The parts of a policy a presenter talks about: what it gates, when it
// triggers and who has to say yes
function summarize(p: Policy) {
    const groups = 'approvalGroups' in p.action ? p.action.approvalGroups.map(g => ({
        name: g.name,
        quorum: g.quorum,
        // An empty approvers object means anyone in the organization
        approvers: 'userId' in g.approvers ? g.approvers.userId?.in ?? [] : [],
        anyone: Object.keys(g.approvers).length === 0,
        serviceAccountsCanApprove: g.serviceAccountsCanApprove ?? false,
        initiatorCanApprove: g.initiatorCanApprove ?? false,
    })) : []
    return { id: p.id, name: p.name, status: p.status, activityKind: p.activityKind, rule: p.rule.kind, action: p.action.kind, approvalGroups: groups, filters: 'filters' in p ? p.filters : undefined }
}

// Policies change rarely: read them once, refresh on demand
let policies: { at: number; data: unknown } | null = null

async function readPolicies() {
    if (policies && Date.now() - policies.at < 60_000) return policies.data
    const read = async (key: string) => {
        const id = env(key)
        if (!id) return { error: `${key} is not set: run 'npm run setup'` }
        try {
            return summarize(await api.policies.getPolicy({ policyId: id }))
        } catch (e) {
            return { id, error: errorDetail(e).message }
        }
    }
    const data = { quarantine: await read('QUARANTINE_POLICY_ID'), withdrawal: await read('WITHDRAWAL_POLICY_ID') }
    policies = { at: Date.now(), data }
    return data
}

export async function controls() {
    return {
        vault: state.vault ? { ...state.vault, tag: TAG, network: 'EthereumSepolia' } : { id: env('VAULT_ID'), tag: TAG, network: 'EthereumSepolia' },
        checkerUserId: env('CHECKER_USER_ID') || null,
        approverUserIds: env('APPROVER_USER_IDS').split(',').map(s => s.trim()).filter(Boolean),
        policies: await readPolicies(),
        explorer: 'https://sepolia.etherscan.io',
    }
}

// The gate is a separate process (npm run gate). Its decisions are only what
// it was sent: here, the simulator's requests, since a SaaS org's signer
// isn't configured to call it.
export async function gateDecisions() {
    const url = `http://localhost:${env('GATE_PORT') || 4000}/decisions`
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
        if (!res.ok) return { running: false, url, error: `HTTP ${res.status}` }
        return { running: true, url, ...(await res.json() as object) }
    } catch (e) {
        return { running: false, url, error: e instanceof Error ? e.message : String(e) }
    }
}

// Who decided an approval and why. Decided approvals don't change, so each
// is fetched once.
const decided = new Map<string, unknown>()

export async function approval(approvalId: string) {
    if (decided.has(approvalId)) return decided.get(approvalId)
    const a = await api.policies.getApproval({ approvalId })
    const checker = env('CHECKER_USER_ID')
    const view = {
        id: a.id,
        status: a.status,
        initiatorId: a.initiatorId,
        dateCreated: a.dateCreated,
        dateResolved: a.dateResolved,
        policies: a.policyEvaluations.map(p => ({ policyId: p.policyId, triggered: p.triggered, reason: p.reason })),
        decisions: a.decisions.map(d => ({ ...d, by: d.userId === checker ? 'checker' : 'person' })),
    }
    if (a.status !== 'Pending') decided.set(approvalId, view)
    return view
}
