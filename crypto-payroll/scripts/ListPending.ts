import { dfnsApi, TREASURY_WALLET_ID } from './DfnsCommon.js'

// Lists all pending policy approvals for the treasury wallet.
// Use this to see which large transfers are waiting for a human decision.
//
// Usage: npx tsx scripts/ListPending.ts

async function main() {
    try {
        const approvals = await dfnsApi.policies.listApprovals({ query: { status: 'Pending' } })

        console.log('--- Pending Payroll Approvals ---')

        if (approvals.items.length === 0) {
            console.log('No pending approvals.')
            return
        }

        let found = 0
        for (const approval of approvals.items) {
            const activity = approval.activity as any

            const walletId =
                activity.walletId ||
                activity.transferRequest?.walletId ||
                activity.transactionRequest?.walletId ||
                activity.signRequest?.walletId

            if (TREASURY_WALLET_ID && walletId !== TREASURY_WALLET_ID) continue

            const reqBody = activity.transferRequest?.requestBody
            const to = reqBody?.to || 'unknown'
            const amountUsdc = reqBody?.amount ? Number(BigInt(reqBody.amount)) / 1e6 : '?'

            console.log(`\x1b[36mID:\x1b[0m ${approval.id}`)
            console.log(`  \x1b[33mTo:\x1b[0m       ${to}`)
            console.log(`  \x1b[33mAmount:\x1b[0m   ${amountUsdc} USDC`)
            console.log(`  \x1b[33mCreated:\x1b[0m  ${approval.dateCreated ? new Date(approval.dateCreated).toLocaleString() : 'unknown'}`)
            console.log(`  \x1b[33mStatus:\x1b[0m   ${approval.status}`)
            console.log('---')
            found++
        }

        if (found === 0) {
            console.log('No pending approvals for this treasury wallet.')
        }
    } catch (error: any) {
        if (error.context?.body) {
            console.error('Failed:', JSON.stringify(error.context.body, null, 2))
        } else {
            console.error('Failed:', error)
        }
        process.exit(1)
    }
}

main()
