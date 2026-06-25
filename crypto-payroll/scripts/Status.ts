import { dfnsApi, TREASURY_WALLET_ID } from './DfnsCommon.js'

// Shows the most recent transfers from the treasury wallet with their on-chain status.
//
// Usage: npx tsx scripts/Status.ts

async function main() {
    if (!TREASURY_WALLET_ID) {
        throw new Error('TREASURY_WALLET_ID not set in .env')
    }

    try {
        const result = await dfnsApi.wallets.listTransfers({ walletId: TREASURY_WALLET_ID })
        const transfers = result.items.slice(0, 20)

        console.log(`--- Transfer Status — Treasury ${TREASURY_WALLET_ID} ---`)
        console.log(`Showing last ${transfers.length} transfer(s)\n`)

        if (transfers.length === 0) {
            console.log('No transfers found.')
            return
        }

        for (const t of transfers) {
            const tr = t as any
            const reqBody = tr.requestBody
            const to = reqBody?.to || 'unknown'
            const amountUsdc = reqBody?.amount ? Number(BigInt(reqBody.amount)) / 1e6 : '?'
            const date = tr.dateCreated ? new Date(tr.dateCreated).toLocaleString() : 'unknown'

            const statusColor =
                tr.status === 'Confirmed' ? '\x1b[32m' :
                tr.status === 'Failed' ? '\x1b[31m' :
                tr.status === 'Pending' ? '\x1b[33m' : '\x1b[0m'

            console.log(`${statusColor}${tr.status}\x1b[0m  ${amountUsdc} USDC → ${to}`)
            console.log(`         ID: ${tr.id} | ${date}`)
            if (tr.txHash) console.log(`         Tx: ${tr.txHash}`)
            console.log('')
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
