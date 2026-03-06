import { encodeDeployData, parseUnits } from 'viem'
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
        console.log('--- Deploy Bond ---')

        const wallet = await dfnsApi.wallets.getWallet({ walletId: ISSUER_WALLET_ID })
        console.log(`Deploying from: ${wallet.address}`)

        const name = await ask('Bond Name (default: Corporate Bond): ') || 'Corporate Bond'
        const symbol = await ask('Bond Symbol (default: CB): ') || 'CB'
        const currencyAddress = await ask('Currency Address (StableCoin): ')
        if (!currencyAddress) throw new Error('Currency address is required')

        const notionalInput = await ask('Notional Amount (default: 100): ') || '100'
        const notional = parseUnits(notionalInput, 6)

        const aprInput = await ask('APR in basis points (default: 400 = 4%): ') || '400'
        const apr = BigInt(aprInput)

        const frequencyInput = await ask('Coupon Frequency in seconds (default: 7776000 = 3 months): ') || '7776000'
        const frequency = BigInt(frequencyInput)

        const durationInput = await ask('Duration in seconds (default: 31536000 = 1 year): ') || '31536000'
        const currentBlock = await client.getBlock()
        const maturityDate = currentBlock.timestamp + BigInt(durationInput)

        const capInput = await ask('Cap Amount (default: 1000000): ') || '1000000'
        const cap = parseUnits(capInput, 6)

        rl.close()

        const artifactPath = path.join(__dirname, '../artifacts/contracts/Bond.sol/Bond.json')
        if (!fs.existsSync(artifactPath)) {
            throw new Error(`Artifact not found. Run 'npx hardhat compile' first.`)
        }
        const { abi, bytecode } = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))

        const deployData = encodeDeployData({
            abi,
            bytecode,
            args: [name, symbol, currencyAddress, notional, apr, frequency, maturityDate, cap],
        })

        console.log('Broadcasting deployment...')
        const result = await dfnsApi.wallets.broadcastTransaction({
            walletId: ISSUER_WALLET_ID,
            body: { kind: 'Evm', to: undefined, data: deployData } as any,
        })

        console.log('Tx hash:', result.txHash)

        if (result.txHash) {
            const receipt = await client.waitForTransactionReceipt({ hash: result.txHash as `0x${string}` })
            console.log('Bond deployed at:', receipt.contractAddress)
        } else {
            console.log('Transaction pending approval. ID:', result.id)
        }
    } catch (error) {
        console.error('Deployment failed:', error)
        rl.close()
        process.exit(1)
    }
}

main()
