import { encodeFunctionData, parseUnits } from 'viem'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url';
import { dfnsApi, SENDER_WALLET_ID, CONTRACT_ADDRESS, client } from './DFNSCommon.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!CONTRACT_ADDRESS) {
    throw new Error("CONTRACT_ADDRESS not set in .env — deploy the StableCoin first with `npm run deploy`.");
}

// npx tsx scripts/MintStable.ts <RECIPIENT_ADDRESS> <AMOUNT> 
// npx tsx scripts/MintStable.ts 0x126b39aFd4c1027168bf936B68C4d011793E7609 10
async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log("Usage: npx tsx scripts/MintStable.ts <address> <amount>");
        console.log("Example: npx tsx scripts/MintStable.ts 0x... 100");
        process.exit(1);
    }

    const toAddress = args[0] as `0x${string}`;
    const amountInput = args[1];
    
    // StableCoin decimals() is 6
    const amount = parseUnits(amountInput, 6);

    try {
        console.log(`--- Minting ${amountInput} StableCoins for ${toAddress} ---`);
        console.log(`Using Wallet: ${SENDER_WALLET_ID}`);

        // 1. Read Artifact
        const artifactPath = path.join(__dirname, '../artifacts/contracts/StableCoin.sol/StableCoin.json');
        if (!fs.existsSync(artifactPath)) {
            throw new Error(`Artifact not found at ${artifactPath}. Did you run 'npx hardhat compile'?`);
        }
        const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
        const { abi } = artifact;

        // 2. Encode Function Data
        const mintData = encodeFunctionData({
            abi,
            functionName: 'mint',
            args: [toAddress, amount],
        });

        // 3. Broadcast Transaction
        console.log("Broadcasting transaction...");
        const result = await dfnsApi.wallets.broadcastTransaction({
            walletId: SENDER_WALLET_ID,
            body: {
                kind: "Eip1559",
                to: CONTRACT_ADDRESS as `0x${string}`,
                data: mintData
            } as any
        });

        console.log("Transaction broadcasted successfully!");
        console.log("Transaction Hash:", result.txHash);

        console.log("Waiting for transaction receipt...");
        const receipt = await client.waitForTransactionReceipt({ hash: result.txHash as `0x${string}` });
        
        console.log("\n!!! MINT SUCCESSFUL !!!");
        console.log("Transaction Hash:", receipt.transactionHash);
        console.log("Block Number:", receipt.blockNumber);

    } catch (error) {
        console.error("Failed to mint:", error);
        process.exit(1);
    }
}

main();
