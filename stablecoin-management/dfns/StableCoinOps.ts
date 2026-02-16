import { encodeFunctionData } from 'viem'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import readline from 'readline'
import { dfnsApi, BANK_WALLET_ID } from './DfnsCommon.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const CONTRACT_ADDRESS = process.argv[2]
if (!CONTRACT_ADDRESS) {
    console.error("Usage: npm run ops <contractAddress>")
    console.error("Example: npm run ops 0x1234...")
    process.exit(1)
}

// Read ABI
const artifactPath = path.join(__dirname, '../artifacts/contracts/StableCoin.sol/StableCoin.json')
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
const { abi } = artifact

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})

function askQuestion(query: string): Promise<string> {
    return new Promise(resolve => rl.question(query, resolve))
}

async function broadcast(functionName: string, args: any[] = []) {
    console.log(`Preparing to ${functionName}...`)

    try {
        const data = encodeFunctionData({
            abi,
            functionName,
            args
        })

        const transaction = {
            kind: "Eip1559",
            to: CONTRACT_ADDRESS,
            data: data,
        }

        console.log("Broadcasting transaction...")
        const result = await dfnsApi.wallets.broadcastTransaction({
            walletId: BANK_WALLET_ID,
            body: transaction as any
        })

        console.log("Transaction broadcasted successfully!")
        console.log("Transaction ID:", result.id)
        console.log("Transaction Hash:", result.txHash)
        console.log("Status:", result.status)
    } catch (error) {
        console.error("Failed to broadcast transaction:", JSON.stringify(error, null, 2))
    }
}

async function main() {
    console.log(`\nStableCoin Operations — Contract: ${CONTRACT_ADDRESS}`)

    while (true) {
        console.log('\n--- Smart Contract Operations ---')
        console.log('1. Pause')
        console.log('2. Unpause')
        console.log('3. Mint')
        console.log('4. Burn')
        console.log('5. Exit')

        const choice = await askQuestion('Select an operation (1-5): ')

        switch (choice) {
            case '1':
                await broadcast('pause')
                break
            case '2':
                await broadcast('unpause')
                break
            case '3':
                const mintTo = await askQuestion('Enter recipient address: ')
                const mintAmount = await askQuestion('Enter amount to mint: ')
                await broadcast('mint', [mintTo, BigInt(mintAmount)])
                break
            case '4':
                const burnAmount = await askQuestion('Enter amount to burn: ')
                const confirmBurn = await askQuestion(`⚠️  WARNING: You are about to burn ${burnAmount} tokens from wallet ${BANK_WALLET_ID}. Type 'yes' to confirm: `)
                if (confirmBurn.toLowerCase() !== 'yes') {
                    console.log('Burn operation cancelled.')
                    break
                }
                await broadcast('burn', [BigInt(burnAmount)])
                break
            case '5':
                console.log('Exiting...')
                rl.close()
                return
            default:
                console.log('Invalid choice. Please try again.')
        }
    }
}

main()
