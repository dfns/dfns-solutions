import { dfnsApi } from './DfnsCommon.js'

// Manually approves a pending payroll transfer that exceeded the auto-approve limit.
//
// Usage: npx tsx scripts/Approve.ts <approvalId>

async function main() {
    const approvalId = process.argv[2]
    if (!approvalId) {
        console.error('Usage: npx tsx scripts/Approve.ts <approvalId>')
        console.error('Run `npm run approvals:list` to find pending approval IDs.')
        process.exit(1)
    }

    console.log(`Approving ${approvalId}...`)
    try {
        await dfnsApi.policies.createApprovalDecision({
            approvalId,
            body: { value: 'Approved', reason: 'Transfer verified and approved manually' },
        })
        console.log('Approved. The transfer will now broadcast to the network.')
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
