import { dfnsApi } from './DfnsCommon.js'

// Lists all users and service accounts in the org so you can find POLICY_USER_ID.
//
// Usage: npx tsx scripts/ListUsers.ts

async function main() {
    try {
        const users = await dfnsApi.auth.listUsers()
        console.log('Users:')
        console.log(JSON.stringify(
            users.items.map((u: any) => ({ userId: u.userId, username: u.username })),
            null, 2
        ))

        // @ts-ignore
        const sas = await dfnsApi.auth.listServiceAccounts()
        console.log('\nService Accounts:')
        console.log(JSON.stringify(sas.items, null, 2))
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
