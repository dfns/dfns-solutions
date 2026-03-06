import { encodeFunctionData, parseUnits, formatUnits } from 'viem'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import readline from 'readline'
import { dfnsApi, ISSUER_WALLET_ID, client } from './dfns.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = (q: string): Promise<string> => new Promise(resolve => rl.question(q, resolve))

let bondAbi: any
let currencyAbi: any
let bondAddress: string

function loadAbi(name: string) {
    const artifactPath = path.join(__dirname, `../artifacts/contracts/${name}.sol/${name}.json`)
    if (!fs.existsSync(artifactPath)) throw new Error(`Artifact not found: ${artifactPath}`)
    return JSON.parse(fs.readFileSync(artifactPath, 'utf8')).abi
}

async function viewStatus() {
    console.log('\n--- Bond Status ---')
    const addr = bondAddress as `0x${string}`
    const read = (fn: string) => client.readContract({ address: addr, abi: bondAbi, functionName: fn })

    const totalIssued = await read('totalBondsIssued')
    const totalRedeemed = await read('totalBondsRedeemed')
    const issuanceDate = await read('issuanceDate') as bigint
    const maturityDate = await read('maturityDate') as bigint
    const timeToNext = await read('timeToNextCoupon') as bigint

    console.log(`Total Bonds Issued: ${totalIssued}`)
    console.log(`Total Bonds Redeemed: ${totalRedeemed}`)
    console.log(`Issuance Date: ${issuanceDate} (${new Date(Number(issuanceDate) * 1000).toLocaleString()})`)
    console.log(`Maturity Date: ${maturityDate} (${new Date(Number(maturityDate) * 1000).toLocaleString()})`)
    console.log(`Time to Next Coupon: ${timeToNext} seconds`)
}

async function broadcast(contractAddress: string, abi: any, functionName: string, args: any[] = []) {
    console.log(`Calling ${functionName}...`)
    const data = encodeFunctionData({ abi, functionName, args })

    const result = await dfnsApi.wallets.broadcastTransaction({
        walletId: ISSUER_WALLET_ID,
        body: { kind: 'Eip1559', to: contractAddress, data } as any,
    })

    console.log('Tx hash:', result.txHash)
    await client.waitForTransactionReceipt({ hash: result.txHash as `0x${string}` })
    console.log('Confirmed.\n')
}

async function main() {
    bondAbi = loadAbi('Bond')
    currencyAbi = loadAbi('StableCoin')

    bondAddress = await ask('Bond Contract Address: ')
    if (!bondAddress) { rl.close(); return }

    while (true) {
        console.log('\n--- Issuer Operations ---')
        console.log('1. View Status')
        console.log('2. Close Issuance')
        console.log('3. Withdraw Proceeds')
        console.log('4. Return Principal')
        console.log('5. Deposit Coupon')
        console.log('6. Exit')

        const choice = await ask('Select (1-6): ')

        switch (choice) {
            case '1':
                await viewStatus()
                break
            case '2':
                await broadcast(bondAddress, bondAbi, 'closePrimaryIssuance')
                break
            case '3':
                await broadcast(bondAddress, bondAbi, 'withdrawProceeds')
                break
            case '4': {
                const amountInput = await ask('Principal Amount to Return: ')
                const amount = parseUnits(amountInput, 6)
                const currencyAddr = await client.readContract({
                    address: bondAddress as `0x${string}`, abi: bondAbi, functionName: 'currency',
                }) as string
                await broadcast(currencyAddr, currencyAbi, 'approve', [bondAddress, amount])
                await broadcast(bondAddress, bondAbi, 'returnPrincipal', [amount])
                break
            }
            case '5': {
                const couponAmount = await client.readContract({
                    address: bondAddress as `0x${string}`, abi: bondAbi, functionName: 'getCouponAmount',
                }) as bigint
                const nextCoupon = await client.readContract({
                    address: bondAddress as `0x${string}`, abi: bondAbi, functionName: 'getNextUnfundedCoupon',
                }) as bigint
                console.log(`Next Coupon Index: ${nextCoupon}`)
                console.log(`Required Amount: ${formatUnits(couponAmount, 6)} EURC`)

                const currencyAddr = await client.readContract({
                    address: bondAddress as `0x${string}`, abi: bondAbi, functionName: 'currency',
                }) as string
                await broadcast(currencyAddr, currencyAbi, 'approve', [bondAddress, couponAmount])
                await broadcast(bondAddress, bondAbi, 'depositCoupon', [])
                break
            }
            case '6':
                rl.close()
                process.exit(0)
            default:
                console.log('Invalid choice.')
        }
    }
}

main()
