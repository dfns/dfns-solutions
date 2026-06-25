import { dfnsApi } from './DfnsCommon.js'

// Manually rejects a pending payroll transfer.
//
// Usage: npx tsx scripts/Reject.ts <approvalId>

async function main() {
    const approvalId = process.argv[2]
    if (!approvalId) {
        console.error('Usage: npx tsx scripts/Reject.ts <approvalId>')
        console.error('Run `npm run approvals:list` to find pending approval IDs.')
        process.exit(1)
    }

    console.log(`Rejecting ${approvalId}...`)
    try {
        await dfnsApi.policies.createApprovalDecision({
            approvalId,
            body: { value: 'Denied', reason: 'Transfer rejected manually' },
        })
        console.log('Rejected. The transfer will not broadcast.')
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
