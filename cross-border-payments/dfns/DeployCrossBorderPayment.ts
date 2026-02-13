import { encodeDeployData, encodeFunctionData, parseUnits } from 'viem'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dfnsApi, BANK_WALLET_ID, SENDER_WALLET_ID, publicClient } from './DfnsCommon.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function broadcast(walletId: string, transaction: any) {
    console.log(`Broadcasting transaction from ${walletId}...`)
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
    // 1. Get Wallet Addresses
    const wallet = await dfnsApi.wallets.getWallet({ walletId: BANK_WALLET_ID })
    const bankAddress = wallet.address
    console.log(`Bank Address: ${bankAddress}`)

    const senderWallet = await dfnsApi.wallets.getWallet({ walletId: SENDER_WALLET_ID })
    const senderAddress = senderWallet.address
    console.log(`Sender Address: ${senderAddress}`)

    // 2. Read Artifacts
    const stableCoinArtifactPath = path.join(__dirname, '../artifacts/contracts/StableCoin.sol/StableCoin.json')
    const stableCoinArtifact = JSON.parse(fs.readFileSync(stableCoinArtifactPath, 'utf8'))

    const crossBorderArtifactPath = path.join(__dirname, '../artifacts/contracts/CrossBorderPayment.sol/CrossBorderPayment.json')
    const crossBorderArtifact = JSON.parse(fs.readFileSync(crossBorderArtifactPath, 'utf8'))

    // 3. Deploy iEUR
    console.log("Deploying iEUR...")
    const deployEuroData = encodeDeployData({
        abi: stableCoinArtifact.abi,
        bytecode: stableCoinArtifact.bytecode,
        args: [bankAddress, "Interest EUR", "iEUR"],
    })

    const euroTx = {
        kind: "Eip1559",
        to: undefined,
        data: deployEuroData,
    } as const
    const euroReceipt = await broadcast(BANK_WALLET_ID, euroTx)
    const iEURAddress = euroReceipt.contractAddress!
    console.log("iEUR Deployed at:", iEURAddress)

    // 4. Deploy iAUD
    console.log("Deploying iAUD...")
    const deployAudData = encodeDeployData({
        abi: stableCoinArtifact.abi,
        bytecode: stableCoinArtifact.bytecode,
        args: [bankAddress, "Interest AUD", "iAUD"],
    })
    const audTx = {
        kind: "Eip1559",
        to: undefined,
        data: deployAudData,
    } as const
    const audReceipt = await broadcast(BANK_WALLET_ID, audTx)
    const iAUDAddress = audReceipt.contractAddress!
    console.log("iAUD Deployed at:", iAUDAddress)

    // 5. Deploy CrossBorderPayment
    console.log("Deploying CrossBorderPayment...")
    const deployCbpData = encodeDeployData({
        abi: crossBorderArtifact.abi,
        bytecode: crossBorderArtifact.bytecode,
        args: [iEURAddress, iAUDAddress],
    })
    const cbpTx = {
        kind: "Eip1559",
        to: undefined,
        data: deployCbpData,
    } as const
    const cbpReceipt = await broadcast(BANK_WALLET_ID, cbpTx)
    const cbpAddress = cbpReceipt.contractAddress!
    console.log("CrossBorderPayment Deployed at:", cbpAddress)

    // 6. Transfer iAUD ownership to CrossBorderPayment
    console.log("Transferring iAUD ownership to CrossBorderPayment...")
    const transferOwnershipData = encodeFunctionData({
        abi: stableCoinArtifact.abi,
        functionName: "transferOwnership",
        args: [cbpAddress]
    })
    const transferTx = {
        kind: "Eip1559",
        to: iAUDAddress,
        data: transferOwnershipData
    } as const
    await broadcast(BANK_WALLET_ID, transferTx)
    console.log("iAUD ownership transferred.")

    // 7. Mint 1000 iEUR to Sender
    console.log("Minting 1000 iEUR to Sender...")
    const mintData = encodeFunctionData({
        abi: stableCoinArtifact.abi,
        functionName: "mint",
        args: [senderAddress, parseUnits("1000", 6)]
    })
    const mintTx = {
        kind: "Eip1559",
        to: iEURAddress,
        data: mintData
    } as const
    await broadcast(BANK_WALLET_ID, mintTx)
    console.log("Minted 1000 iEUR to sender.")

    console.log("\nDeployment and Setup Complete!")
    console.log("iEUR:", iEURAddress)
    console.log("iAUD:", iAUDAddress)
    console.log("CrossBorderPayment:", cbpAddress)
}

main()
