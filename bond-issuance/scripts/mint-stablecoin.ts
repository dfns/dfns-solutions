import { encodeFunctionData, parseUnits } from 'viem'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import readline from 'readline'
import { dfnsApi, ISSUER_WALLET_ID, client } from './dfns.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = (q: string): Promise<string> => new Promise(resolve => rl.question(q, resolve))

async function main() {
    try {
        console.log('--- Mint StableCoin ---')

        const wallet = await dfnsApi.wallets.getWallet({ walletId: ISSUER_WALLET_ID })
        console.log(`Minting from (Minter Role): ${wallet.address}`)

        const contractAddress = await ask('StableCoin Contract Address: ')
        if (!contractAddress) throw new Error('Contract address is required')

        const toAddress = await ask('Recipient Address: ')
        if (!toAddress) throw new Error('Recipient address is required')

        const amountInput = await ask('Amount to Mint: ')
        if (!amountInput) throw new Error('Amount is required')
        const amount = parseUnits(amountInput, 6)

        rl.close()

        const artifactPath = path.join(__dirname, '../artifacts/contracts/StableCoin.sol/StableCoin.json')
        if (!fs.existsSync(artifactPath)) {
            throw new Error(`Artifact not found. Run 'npx hardhat compile' first.`)
        }
        const { abi } = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))

        const data = encodeFunctionData({ abi, functionName: 'mint', args: [toAddress, amount] })

        console.log('Broadcasting transaction...')
        const result = await dfnsApi.wallets.broadcastTransaction({
            walletId: ISSUER_WALLET_ID,
            body: { kind: 'Evm', to: contractAddress, data } as any,
        })

        console.log('Tx hash:', result.txHash)
        await client.waitForTransactionReceipt({ hash: result.txHash as `0x${string}` })
        console.log('Mint successful!')
    } catch (error) {
        console.error('Mint failed:', error)
        rl.close()
        process.exit(1)
    }
}

main()
