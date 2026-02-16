import { encodeFunctionData, keccak256, stringToBytes } from 'viem'
import fs from 'fs'
import path from 'path'
import readline from 'readline'
import { fileURLToPath } from 'url'
import { dfnsApi, BANK_WALLET_ID, publicClient } from './DfnsCommon.js'

function askQuestion(question: string): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer) }))
}

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

    if (!action || action === 'help') {
        console.log("Usage: npm run receiver-cli <action> [args]")
        console.log("Available actions:")
        console.log("  grantRole <roleName> <contractAddress> <accountAddress>      - Grant a role to an account")
        process.exit(0)
    }

    if (action === 'grantRole') {
        const roleName = args[1]
        const contractAddress = args[2]
        const accountAddress = args[3]

        if (!roleName || !contractAddress || !accountAddress) {
            console.error("Usage: grantRole <roleName> <contractAddress> <accountAddress>")
            process.exit(1)
        }

        console.log(`Granting Role...`)
        console.log(`Role: ${roleName}`)
        console.log(`Contract: ${contractAddress}`)
        console.log(`Account: ${accountAddress}`)

        const confirmGrant = await askQuestion(`⚠️  WARNING: You are about to grant role '${roleName}' to ${accountAddress}. Type 'yes' to confirm: `)
        if (confirmGrant.toLowerCase() !== 'yes') {
            console.log('Grant role operation cancelled.')
            process.exit(0)
        }

        const roleHash = keccak256(stringToBytes(roleName))
        console.log(`Role Hash: ${roleHash}`)

        const grantRoleData = encodeFunctionData({
            abi: stableCoinArtifact.abi,
            functionName: "grantRole",
            args: [roleHash, accountAddress]
        })

        // Use BANK_WALLET_ID (Admin) to grant role
        await broadcast(BANK_WALLET_ID, contractAddress, grantRoleData)
        console.log("Role Granted.")

    } else {
        console.log("Unknown action. Available: grantRole")
        console.log("Run with 'help' for more details.")
    }
}

main()
