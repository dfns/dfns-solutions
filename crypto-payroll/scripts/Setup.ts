import { dfnsApi, POLICY_USER_ID } from './DfnsCommon.js'

// Creates a Wallets:Sign policy that intercepts every transfer from the payroll
// treasury wallet. The auto-reviewer approves transfers <= AUTO_APPROVE_LIMIT_USDC;
// anything larger sits Pending until a human approves or rejects it.
//
// Usage: npx tsx scripts/Setup.ts

async function main() {
    if (!POLICY_USER_ID) {
        throw new Error('POLICY_USER_ID not set in .env — run `npm run users:list` to find it.')
    }

    console.log('Creating payroll approval policy...')

    try {
        const policy = await dfnsApi.policies.createPolicy({
            body: {
                name: 'Payroll Transfer Policy',
                activityKind: 'Wallets:Sign',
                rule: {
                    kind: 'AlwaysTrigger',
                },
                action: {
                    kind: 'RequestApproval',
                    approvalGroups: [
                        {
                            name: 'PayrollApprovers',
                            quorum: 1,
                            approvers: {
                                userId: {
                                    in: [POLICY_USER_ID],
                                },
                            },
                            initiatorCanApprove: true, // NOTE: set false in production (maker/checker separation)
                            serviceAccountsCanApprove: true,
                        },
                    ],
                },
                filters: {
                    walletTags: {
                        hasAny: ['payroll'],
                    },
                },
            },
        })

        console.log(`Policy created: "${policy.name}" (${policy.id})`)
        console.log('')
        console.log('Next steps:')
        console.log('  1. Tag your treasury wallet with "payroll" in the Dfns dashboard.')
        console.log('  2. Run `npm run payroll:run` to send this month\'s payroll.')
        console.log('  3. Run `npm run approvals:auto` to let the service account review pending transfers.')
    } catch (error: any) {
        if (error.context?.body) {
            console.error('Failed to create policy:', JSON.stringify(error.context.body, null, 2))
        } else {
            console.error('Failed to create policy:', error)
        }
        process.exit(1)
    }
}

main()
