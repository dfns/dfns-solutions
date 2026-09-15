import { dfnsApi, TREASURY_WALLET_ID, USDC_CONTRACT, AUTO_APPROVE_LIMIT_USDC } from './DfnsCommon.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parseUnits } from 'viem'
import crypto from 'crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Usage: npx tsx scripts/RunPayroll.ts
// Reads data/employees.csv and sends a USDC transfer to every employee.
// The Dfns policy intercepts each transfer. The auto-reviewer (approvals:auto)
// approves transfers <= AUTO_APPROVE_LIMIT_USDC; larger ones wait for human review.

interface Employee {
    name: string
    address: string
    amount_usdc: string
}

function parseCSV(csvPath: string): Employee[] {
    const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n')
    return lines.slice(1).map(line => {
        const [name, address, amount_usdc] = line.split(',').map(v => v.trim())
        return { name, address, amount_usdc }
    })
}

function payrollId(address: string, run: string): string {
    return crypto.createHash('sha256')
        .update(`payroll-${run}-${address}`)
        .digest('hex')
        .slice(0, 36)
}

async function main() {
    if (!TREASURY_WALLET_ID) {
        throw new Error('TREASURY_WALLET_ID not set in .env')
    }

    const csvPath = path.join(__dirname, '../data/employees.csv')
    if (!fs.existsSync(csvPath)) {
        throw new Error(`data/employees.csv not found at ${csvPath}`)
    }

    const employees = parseCSV(csvPath)
    const runId = new Date().toISOString().slice(0, 10) // e.g. 2026-06-25

    console.log(`--- Payroll Run ${runId} — ${employees.length} employee(s) ---`)
    console.log(`Treasury Wallet: ${TREASURY_WALLET_ID}`)
    console.log(`USDC Contract:   ${USDC_CONTRACT}`)
    console.log(`Auto-approve <=: ${AUTO_APPROVE_LIMIT_USDC} USDC`)
    console.log('')

    for (const emp of employees) {
        const amountUsdc = Number(emp.amount_usdc)
        if (isNaN(amountUsdc) || amountUsdc <= 0) {
            console.log(`  Skipping ${emp.name}: invalid amount "${emp.amount_usdc}"`)
            continue
        }

        const amount = parseUnits(emp.amount_usdc, 6).toString()
        const externalId = payrollId(emp.address, runId)
        const flag = amountUsdc > AUTO_APPROVE_LIMIT_USDC ? ' ⚑ awaits human review' : ''

        console.log(`Sending ${emp.amount_usdc} USDC → ${emp.name} (${emp.address})${flag}`)

        try {
            const transfer = await dfnsApi.wallets.transferAsset({
                walletId: TREASURY_WALLET_ID,
                body: {
                    kind: 'Erc20',
                    contract: USDC_CONTRACT,
                    to: emp.address,
                    amount,
                    externalId,
                },
            })
            console.log(`  Transfer ID: ${transfer.id} | Status: ${transfer.status}`)
        } catch (error: any) {
            if (error.context?.body) {
                console.error(`  Failed: ${JSON.stringify(error.context.body)}`)
            } else {
                console.error(`  Failed: ${error.message}`)
            }
        }
    }

    console.log('')
    console.log('Done. Run `npm run approvals:auto` to process pending approvals.')
    console.log('Run `npm run approvals:list` to see what needs human review.')
}

main().catch(err => {
    console.error('Payroll run failed:', err)
    process.exit(1)
})
