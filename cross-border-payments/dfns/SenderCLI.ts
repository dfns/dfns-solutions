import { encodeFunctionData, parseUnits, decodeEventLog } from 'viem'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dfnsApi, SENDER_WALLET_ID, publicClient } from './DfnsCommon.js'

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

    // Read Artifacts
    const stableCoinArtifact = JSON.parse(fs.readFileSync(path.join(__dirname, '../artifacts/contracts/StableCoin.sol/StableCoin.json'), 'utf8'))
    const crossBorderArtifact = JSON.parse(fs.readFileSync(path.join(__dirname, '../artifacts/contracts/CrossBorderPayment.sol/CrossBorderPayment.json'), 'utf8'))

    if (!action || action === 'help') {
        console.log("Usage: npm run sender-cli <action> [args]")
        console.log("Available actions:")
        console.log("  init <cbpAddress> <iEurAddress> <receiverAddress> <amount>   - Initialize a cross-border payment")
        console.log("  execute <cbpAddress> <paymentId>                             - Execute a pending payment")
        console.log("  approve <tokenAddress> <spenderAddress> <amount>             - Approve a spender to spend amount of tokens")
        process.exit(0)
    }

    if (action === 'approve') {
        const tokenAddress = args[1]
        const spenderAddress = args[2]
        const amountStr = args[3]

        if (!tokenAddress || !spenderAddress || !amountStr) {
            console.error("Usage: approve <tokenAddress> <spenderAddress> <amount>")
            process.exit(1)
        }

        const amount = parseUnits(amountStr, 6)

        console.log(`Approving...`)
        console.log(`Token: ${tokenAddress}`)
        console.log(`Spender: ${spenderAddress}`)
        console.log(`Amount: ${amountStr} (${amount})`)

        const approveData = encodeFunctionData({
            abi: stableCoinArtifact.abi,
            functionName: "approve",
            args: [spenderAddress, amount]
        })

        await broadcast(SENDER_WALLET_ID, tokenAddress, approveData)
        console.log("Approved.")

    } else if (action === 'init') {
        const cbpAddress = args[1]
        const iEurAddress = args[2]
        const receiverAddress = args[3]
        const amountStr = args[4]

        if (!cbpAddress || !iEurAddress || !receiverAddress || !amountStr) {
            console.error("Usage: init <cbpAddress> <iEurAddress> <receiverAddress> <amount>")
            process.exit(1)
        }

        const amount = parseUnits(amountStr, 6)

        console.log(`Initiating Payment...`)
        console.log(`Contract: ${cbpAddress}`)
        console.log(`iEUR: ${iEurAddress}`)
        console.log(`Receiver: ${receiverAddress}`)
        console.log(`Amount: ${amountStr} (${amount})`)

        // 1. Approve
        console.log("Step 1: Approving iEUR...")
        const approveData = encodeFunctionData({
            abi: stableCoinArtifact.abi,
            functionName: "approve",
            args: [cbpAddress, amount]
        })
        await broadcast(SENDER_WALLET_ID, iEurAddress, approveData)
        console.log("Approved.")

        // 2. Init Payment
        console.log("Step 2: Calling initPayment...")
        const initData = encodeFunctionData({
            abi: crossBorderArtifact.abi,
            functionName: "initPayment",
            args: [receiverAddress, amount]
        })
        const receipt = await broadcast(SENDER_WALLET_ID, cbpAddress, initData)

        // Find Event
        for (const log of receipt.logs) {
            try {
                const event = decodeEventLog({
                    abi: crossBorderArtifact.abi,
                    data: log.data,
                    topics: log.topics,
                }) as any
                if (event.eventName === 'PaymentInitiated') {
                    const paymentId = event.args.paymentId
                    console.log(`Payment Initiated. ID: ${paymentId}`)
                }
            } catch (e) {
                // Ignore logs that aren't ours
            }
        }

    } else if (action === 'execute') {
        const cbpAddress = args[1]
        const paymentId = args[2]

        if (!cbpAddress || !paymentId) {
            console.error("Usage: execute <cbpAddress> <paymentId>")
            process.exit(1)
        }

        console.log(`Executing Payment ${paymentId}...`)

        const executeData = encodeFunctionData({
            abi: crossBorderArtifact.abi,
            functionName: "executePayment",
            args: [BigInt(paymentId)]
        })

        await broadcast(SENDER_WALLET_ID, cbpAddress, executeData)
        console.log("Payment Executed.")

    } else {
        console.log("Unknown action. Available: init, execute, approve")
        console.log("Run with 'help' for more details.")
    }
}

main()
