import { encodeFunctionData, parseUnits, formatUnits } from 'viem'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import readline from 'readline'
import { dfnsApi, ISSUER_WALLET_ID, readContract, broadcast } from './dfns.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = (q: string): Promise<string> => new Promise(resolve => rl.question(q, resolve))

let currencyAbi: any
let currencyAddress: string

function loadAbi(name: string) {
    const artifactPath = path.join(__dirname, `../artifacts/contracts/${name}.sol/${name}.json`)
    if (!fs.existsSync(artifactPath)) throw new Error(`Artifact not found: ${artifactPath}`)
    return JSON.parse(fs.readFileSync(artifactPath, 'utf8')).abi
}

async function viewStatus() {
    console.log('\n--- StableCoin Status ---')
    const addr = currencyAddress

    const totalMinted = BigInt(await readContract({ address: addr, abi: currencyAbi, functionName: 'totalMinted' }) as string)
    const totalBurnt = BigInt(await readContract({ address: addr, abi: currencyAbi, functionName: 'totalBurnt' }) as string)
    const paused = await readContract({ address: addr, abi: currencyAbi, functionName: 'paused' })

    const wallet = await dfnsApi.wallets.getWallet({ walletId: ISSUER_WALLET_ID })
    const balance = BigInt(await readContract({ address: addr, abi: currencyAbi, functionName: 'balanceOf', args: [wallet.address] }) as string)

    console.log(`Total Minted: ${formatUnits(totalMinted, 6)}`)
    console.log(`Total Burnt: ${formatUnits(totalBurnt, 6)}`)
    console.log(`Paused: ${paused}`)
    console.log(`Issuer Balance: ${formatUnits(balance, 6)}`)
}

async function callFn(functionName: string, args: any[] = []) {
    console.log(`Calling ${functionName}...`)
    const data = encodeFunctionData({ abi: currencyAbi, functionName, args })
    const result = await broadcast(ISSUER_WALLET_ID, currencyAddress, data)
    console.log('Tx hash:', result.txHash)
    console.log('Confirmed.\n')
}

async function main() {
    currencyAbi = loadAbi('StableCoin')

    currencyAddress = await ask('StableCoin Contract Address: ')
    if (!currencyAddress) { rl.close(); return }

    while (true) {
        console.log('\n--- StableCoin Operations ---')
        console.log('1. View Status')
        console.log('2. Mint')
        console.log('3. Burn')
        console.log('4. Pause')
        console.log('5. Unpause')
        console.log('6. Exit')

        const choice = await ask('Select (1-6): ')

        switch (choice) {
            case '1':
                await viewStatus()
                break
            case '2': {
                const to = await ask('Recipient Address: ')
                const amount = parseUnits(await ask('Amount to Mint: '), 6)
                await callFn('mint', [to, amount])
                break
            }
            case '3': {
                const amount = parseUnits(await ask('Amount to Burn: '), 6)
                await callFn('burn', [amount])
                break
            }
            case '4':
                await callFn('pause')
                break
            case '5':
                await callFn('unpause')
                break
            case '6':
                rl.close()
                return
            default:
                console.log('Invalid choice.')
        }
    }
}

main()
