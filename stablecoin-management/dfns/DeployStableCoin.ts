import { encodeDeployData } from 'viem'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dfnsApi, BANK_WALLET_ID, publicClient } from './DfnsCommon.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function main() {
    // 1. Get Wallet Address
    const wallet = await dfnsApi.wallets.getWallet({ walletId: BANK_WALLET_ID })
    const initialOwner = wallet.address
    console.log(`Deploying from wallet address: ${initialOwner}`)

    // 2. Read Artifact
    const artifactPath = path.join(__dirname, '../artifacts/contracts/StableCoin.sol/StableCoin.json')
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
    const { abi, bytecode } = artifact

    // 3. Encode Deployment Data
    const deployData = encodeDeployData({
        abi,
        bytecode,
        args: [initialOwner, "Bank AUD", "bAUD"],
    })

    console.log("Deployment data encoded.")

    // 4. Broadcast Transaction
    const transaction = {
        kind: "Eip1559",
        to: undefined,
        data: deployData,
    }

    console.log("Broadcasting transaction...")

    try {
        const result = await dfnsApi.wallets.broadcastTransaction({
            walletId: BANK_WALLET_ID,
            body: transaction as any
        })

        console.log("Transaction broadcasted successfully!")
        console.log("Transaction ID:", result.id)
        console.log("Transaction Hash:", result.txHash)
        console.log("Status:", result.status)

        console.log("Waiting for transaction receipt...")
        const receipt = await publicClient.waitForTransactionReceipt({ hash: result.txHash as `0x${string}` })
        console.log("Contract deployed at:", receipt.contractAddress)
    } catch (error) {
        console.error("Failed to broadcast transaction:", JSON.stringify(error, null, 2))
    }
}

main()
