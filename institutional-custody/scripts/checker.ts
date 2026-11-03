// Automatic checker: a service account in the withdrawal approval group that
// votes by rule, like a second pair of eyes that never sleeps. It approves a
// withdrawal only when the amount is under a cap and the destination is on an
// allowlist. Anything else it leaves for a human approver, and says why. It
// never rejects: a rejection by any approver cancels the withdrawal, and that
// call stays with people in this first version.
//
// It runs with the checker's own credentials (CHECKER_*), never the backend's:
// the backend requests withdrawals, and the checker must not be both maker and
// checker.
import { DfnsError } from '@dfns/sdk'
import { requireEnv, env } from '../src/env.js'
import { checkerApi } from '../src/dfns.js'
import { NATIVE_ETH, display } from '../src/units.js'

requireEnv(
    'DFNS_ORG_ID', 'CHECKER_AUTH_TOKEN', 'CHECKER_CRED_ID', 'CHECKER_PRIVATE_KEY', 'CHECKER_USER_ID',
    'WITHDRAWAL_POLICY_ID', 'CHECKER_MAX_AMOUNT_WEI', 'CHECKER_ALLOWLIST',
)

const POLL_MS = 10_000
const CHECKER_ID = env('CHECKER_USER_ID')
const POLICY_ID = env('WITHDRAWAL_POLICY_ID')
const MAX_AMOUNT = BigInt(env('CHECKER_MAX_AMOUNT_WEI'))
// EVM addresses compare case-insensitively (checksums only change the case)
const ALLOWLIST = new Set(env('CHECKER_ALLOWLIST').split(',').map(a => a.trim().toLowerCase()).filter(Boolean))

// People read these reasons in the dashboard and on the page: ETH, not wei
const eth = (wei: string | bigint) => display(wei.toString(), NATIVE_ETH)

type Approval = Awaited<ReturnType<typeof checkerApi.policies.listApprovals>>['items'][number]

// Approvals already left for a human, so each is logged once, not every poll
const leftForHuman = new Set<string>()

async function pendingApprovals() {
    const items: Approval[] = []
    let paginationToken: string | undefined
    do {
        const page = await checkerApi.policies.listApprovals({ query: { status: 'Pending', paginationToken } })
        items.push(...page.items)
        paginationToken = page.nextPageToken
    } while (paginationToken)
    return items
}

// Returns why the checker can't approve, or undefined when every rule passes
function evaluate(approval: Approval) {
    const { activity } = approval
    if (activity.kind !== 'Wallets:Sign' || !activity.transferRequest) {
        return `not a transfer (${activity.kind})`
    }
    const body = activity.transferRequest.requestBody
    // Only native ETH has a wei amount to compare against the cap
    if (body.kind !== 'Native') return `${body.kind} transfer, only native ETH is checked`
    if (!ALLOWLIST.has(body.to.toLowerCase())) return `destination ${body.to} is not on the allowlist`
    if (BigInt(body.amount) > MAX_AMOUNT) return `amount ${eth(body.amount)} is over the cap of ${eth(MAX_AMOUNT)}`
    return undefined
}

function describe(approval: Approval) {
    const t = approval.activity.kind === 'Wallets:Sign' ? approval.activity.transferRequest : undefined
    if (!t) return approval.id
    const amount = 'amount' in t.requestBody ? ` ${eth(t.requestBody.amount)}` : ''
    const to = 'to' in t.requestBody ? ` → ${t.requestBody.to}` : ''
    return `${approval.id} (${t.id}:${amount}${to})`
}

async function checkOnce() {
    for (const approval of await pendingApprovals()) {
        // Only withdrawals gated by the custody policy, where the checker is
        // an approver. Other approvals the checker can see aren't its call.
        if (!approval.policyEvaluations.some(p => p.policyId === POLICY_ID && p.triggered)) continue
        if (approval.decisions.some(d => d.userId === CHECKER_ID)) continue
        if (leftForHuman.has(approval.id)) continue

        const reason = evaluate(approval)
        if (reason) {
            leftForHuman.add(approval.id)
            console.log(`  · ${describe(approval)}: left for a human, ${reason}`)
            continue
        }
        try {
            await checkerApi.policies.createApprovalDecision({
                approvalId: approval.id,
                body: { value: 'Approved', reason: `Checker: destination allowlisted, amount ≤ ${eth(MAX_AMOUNT)}` },
            })
            console.log(`  ✓ ${describe(approval)}: approved`)
        } catch (e) {
            // Leave it for a human rather than retry every poll: a refused
            // vote (e.g. service accounts can't approve on this policy) won't
            // fix itself
            leftForHuman.add(approval.id)
            const detail = e instanceof DfnsError ? `${e.httpStatus} ${e.message}` : String(e)
            console.log(`  ! ${describe(approval)}: vote failed, left for a human: ${detail}`)
        }
    }
}

async function main() {
    console.log(`Checker ${CHECKER_ID} on policy ${POLICY_ID}`)
    console.log(`  cap        ${eth(MAX_AMOUNT)} (${MAX_AMOUNT} wei)`)
    console.log(`  allowlist  ${[...ALLOWLIST].join(', ')}`)
    console.log(`Polling every ${POLL_MS / 1000}s. Ctrl+C to stop.\n`)
    for (;;) {
        try {
            await checkOnce()
        } catch (e) {
            // Keep the loop alive through transient API errors
            console.error('  ! poll failed:', e instanceof Error ? e.message : e)
        }
        await new Promise(r => setTimeout(r, POLL_MS))
    }
}

main().catch(e => {
    console.error(e)
    process.exit(1)
})
