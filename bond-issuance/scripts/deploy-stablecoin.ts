import { encodeDeployData } from 'viem'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import readline from 'readline'
import { dfnsApi, ISSUER_WALLET_ID, broadcast } from './dfns.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = (q: string): Promise<string> => new Promise(resolve => rl.question(q, resolve))

async function main() {
    try {
        console.log('--- Deploy StableCoin ---')

        const wallet = await dfnsApi.wallets.getWallet({ walletId: ISSUER_WALLET_ID })
        console.log(`Deploying from: ${wallet.address}`)

        const name = await ask('StableCoin Name (default: Euro Coin): ') || 'Euro Coin'
        const symbol = await ask('StableCoin Symbol (default: EURC): ') || 'EURC'
        rl.close()

        const artifactPath = path.join(__dirname, '../artifacts/contracts/StableCoin.sol/StableCoin.json')
        if (!fs.existsSync(artifactPath)) {
            throw new Error(`Artifact not found. Run 'npx hardhat compile' first.`)
        }
        const { abi, bytecode } = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))

        const deployData = encodeDeployData({
            abi,
            bytecode,
            args: [wallet.address, name, symbol],
        })

        console.log('Broadcasting deployment...')
        const result = await broadcast(ISSUER_WALLET_ID, undefined, deployData)

        console.log('Tx hash:', result.txHash)
        console.log(`Deployed -- find the contract address at: https://sepolia.etherscan.io/tx/${result.txHash}`)
    } catch (error) {
        console.error('Deployment failed:', error)
        rl.close()
        process.exit(1)
    }
}

main()
