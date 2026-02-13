import { encodeFunctionData, parseUnits } from 'viem'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dfnsApi, BANK_WALLET_ID, publicClient } from './DfnsCommon.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function broadcast(walletId: string, to: string, data: string) {
    console.log(`Broadcasting transaction from ${walletId}...`)
    const transaction = {
        kind: "Eip1559",
        to: to,
        data: data
    } as const
    const result = await dfnsApi.wallets.broadcastTransaction({
        walletId: walletId,
        body: transaction
    })
    console.log("Transaction ID:", result.id)
    console.log("Transaction Hash:", result.txHash)

    console.log("Waiting for receipt...")
    const receipt = await publicClient.waitForTransactionReceipt({ hash: result.txHash as `0x${string}` })
    return receipt
}

async function main() {
    const args = process.argv.slice(2)
    const action = args[0]

    if (!action || action === 'help') {
        console.log("Usage: npm run fx-cli <action> [args]")
        console.log("Available actions:")
        console.log("  set-rate <cbpAddress> <paymentId> <amount>   - Set FX rate for a payment")
        process.exit(0)
    }

    if (action === 'set-rate') {
        const cbpAddress = args[1]
        const paymentId = args[2]
        const amountStr = args[3]

        if (!cbpAddress || !paymentId || !amountStr) {
            console.error("Usage: set-rate <cbpAddress> <paymentId> <amount>")
            process.exit(1)
        }

        const amount = parseUnits(amountStr, 6)

        const crossBorderArtifact = JSON.parse(fs.readFileSync(path.join(__dirname, '../artifacts/contracts/CrossBorderPayment.sol/CrossBorderPayment.json'), 'utf8'))

        console.log(`Setting FX Rate...`)
        console.log(`Contract: ${cbpAddress}`)
        console.log(`Payment ID: ${paymentId}`)
        console.log(`Rate Amount: ${amountStr} (${amount})`)

        const setRateData = encodeFunctionData({
            abi: crossBorderArtifact.abi,
            functionName: "setFXRate",
            args: [BigInt(paymentId), amount]
        })

        await broadcast(BANK_WALLET_ID, cbpAddress, setRateData)
        console.log("FX Rate Set.")
    } else {
        console.error("Unknown action. Available: set-rate")
        console.log("Run with 'help' for more details.")
        process.exit(1)
    }
}

main()
