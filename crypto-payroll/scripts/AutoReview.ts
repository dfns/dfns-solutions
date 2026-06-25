import { dfnsApi, TREASURY_WALLET_ID, USDC_CONTRACT, AUTO_APPROVE_LIMIT_USDC } from './DfnsCommon.js'
import { parseUnits } from 'viem'

// Service-account checker: runs over all Pending approvals for the treasury wallet.
// Transfers <= AUTO_APPROVE_LIMIT_USDC are approved automatically.
// Transfers > AUTO_APPROVE_LIMIT_USDC are left Pending for a human approver.
// Non-USDC transfers and transfers to unknown wallets are denied.
//
// Usage: npx tsx scripts/AutoReview.ts

const AUTO_APPROVE_LIMIT_BASE = parseUnits(String(AUTO_APPROVE_LIMIT_USDC), 6)

async function main() {
    if (!TREASURY_WALLET_ID) {
        throw new Error('TREASURY_WALLET_ID not set in .env')
    }

    const approvals = await dfnsApi.policies.listApprovals({ query: { status: 'Pending' } })

    console.log(`--- Auto-reviewer — treasury ${TREASURY_WALLET_ID} ---`)
    console.log(`Auto-approve limit: ${AUTO_APPROVE_LIMIT_USDC} USDC`)
    console.log('')

    if (approvals.items.length === 0) {
        console.log('No pending approvals.')
        return
    }

    for (const approval of approvals.items) {
        const activity = approval.activity as any

        const walletId =
            activity.walletId ||
            activity.transferRequest?.walletId ||
            activity.transactionRequest?.walletId ||
            activity.signRequest?.walletId

        if (walletId !== TREASURY_WALLET_ID) continue

        console.log(`\x1b[36mApproval ${approval.id}\x1b[0m`)

        const transferReq = activity.transferRequest
        if (!transferReq) {
            console.log('  Not a transfer request — denying.')
            await decide(approval.id, 'Denied', 'Only transfer operations are allowed from this wallet')
            continue
        }

        const reqBody = transferReq.requestBody
        const to: string = reqBody?.to || 'unknown'
        const contract: string = (reqBody?.contract || '').toLowerCase()
        const amount = BigInt(reqBody?.amount || '0')
        const amountUsdc = Number(amount) / 1e6

        console.log(`  To:       ${to}`)
        console.log(`  Amount:   ${amountUsdc} USDC`)
        console.log(`  Contract: ${contract}`)

        if (contract !== USDC_CONTRACT) {
            await decide(approval.id, 'Denied', `Contract ${contract} is not the configured USDC contract`)
            continue
        }

        if (amount <= AUTO_APPROVE_LIMIT_BASE) {
            await decide(approval.id, 'Approved', `${amountUsdc} USDC is within the ${AUTO_APPROVE_LIMIT_USDC} USDC auto-approve limit`)
        } else {
            console.log(`  \x1b[33m⚑ ${amountUsdc} USDC exceeds auto-approve limit — leaving for human review\x1b[0m`)
        }
        console.log('')
    }
}

async function decide(approvalId: string, value: 'Approved' | 'Denied', reason: string) {
    const color = value === 'Approved' ? '\x1b[32m' : '\x1b[31m'
    console.log(`  ${color}${value}\x1b[0m — ${reason}`)
    try {
        await dfnsApi.policies.createApprovalDecision({ approvalId, body: { value, reason } })
    } catch (error: any) {
        console.error(`  Failed to post decision: ${error.message}`)
    }
}

main().catch(err => {
    console.error('Auto-review failed:', err)
    process.exit(1)
})
