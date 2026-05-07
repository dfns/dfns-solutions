import { encodeDeployData } from 'viem'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url';
import readline from 'readline';
import { dfnsApi, SENDER_WALLET_ID, client } from './DFNSCommon.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(query: string): Promise<string> {
    return new Promise(resolve => rl.question(query, resolve));
}

// SC @  https://sepolia.etherscan.io/address/0x007cb8aafaa9eb5b411ebece99f1671a286d2ee8

async function main() {
    try {
        console.log("--- Deploy StableCoin ---");

        // 1. Get Wallet Address
        const wallet = await dfnsApi.wallets.getWallet({ walletId: SENDER_WALLET_ID });
        const initialOwner = wallet.address;
        console.log(`Deploying from wallet address: ${initialOwner}`);

        // 2. Deployment Arguments
        const name = await askQuestion("Enter StableCoin Name (default: StableCoin): ") || "StableCoin";
        const symbol = await askQuestion("Enter StableCoin Symbol (default: STBL): ") || "STBL";

        rl.close();

        // 3. Read Artifact
        const artifactPath = path.join(__dirname, '../artifacts/contracts/StableCoin.sol/StableCoin.json');
        if (!fs.existsSync(artifactPath)) {
            throw new Error(`Artifact not found at ${artifactPath}. Did you run 'npx hardhat compile'?`);
        }
        const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
        const { abi, bytecode } = artifact;

        // 4. Encode Deployment Data
        const deployData = encodeDeployData({
            abi,
            bytecode,
            args: [initialOwner, name, symbol],
        });

        console.log("Deployment data encoded.");

        // 5. Construct Transaction
        const transaction = {
            kind: "Eip1559",
            to: undefined,
            data: deployData,
        };

        console.log("Broadcasting transaction...");

        const result = await dfnsApi.wallets.broadcastTransaction({
            walletId: SENDER_WALLET_ID,
            body: transaction as any
        });

        console.log("Transaction broadcasted successfully!");
        console.log("Transaction ID:", result.id);
        console.log("Transaction Hash:", result.txHash);

        console.log("Waiting for transaction receipt...");
        const receipt = await client.waitForTransactionReceipt({ hash: result.txHash as `0x${string}` });
        console.log("\n!!! DEPLOYMENT SUCCESSFUL !!!");
        console.log("Contract deployed at:", receipt.contractAddress);

    } catch (error) {
        console.error("Failed to deployment:", error);
        rl.close();
        process.exit(1);
    }
}

main();
