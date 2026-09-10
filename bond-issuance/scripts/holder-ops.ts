import { encodeFunctionData, parseUnits, formatUnits } from 'viem'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import readline from 'readline'
import { dfnsApi, INVESTOR_WALLET_ID, readContract, broadcast } from './dfns.js'

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

async function viewStatus(userAddress: string) {
    console.log('\n--- Portfolio ---')
    console.log(`Address: ${userAddress}`)
    const addr = bondAddress

    const balance = await readContract({ address: addr, abi: bondAbi, functionName: 'balanceOf', args: [userAddress] })
    const accrued = await readContract({ address: addr, abi: bondAbi, functionName: 'accruedInterest', args: [userAddress] }) as string
    const totalIssued = await readContract({ address: addr, abi: bondAbi, functionName: 'totalBondsIssued' })
    const totalRedeemed = await readContract({ address: addr, abi: bondAbi, functionName: 'totalBondsRedeemed' })
    const issuanceDate = await readContract({ address: addr, abi: bondAbi, functionName: 'issuanceDate' }) as string
    const maturityDate = await readContract({ address: addr, abi: bondAbi, functionName: 'maturityDate' }) as string
    const timeToNext = await readContract({ address: addr, abi: bondAbi, functionName: 'timeToNextCoupon' }) as string

    console.log(`Bond Balance: ${balance}`)
    console.log(`Accrued Interest: ${formatUnits(BigInt(accrued), 6)} EURC`)
    console.log(`Total Bonds Issued: ${totalIssued}`)
    console.log(`Total Bonds Redeemed: ${totalRedeemed}`)
    console.log(`Issuance Date: ${issuanceDate} (${new Date(Number(issuanceDate) * 1000).toLocaleString()})`)
    console.log(`Maturity Date: ${maturityDate} (${new Date(Number(maturityDate) * 1000).toLocaleString()})`)
    console.log(`Time to Next Coupon: ${timeToNext} seconds`)
}

async function callFn(contractAddress: string, abi: any, functionName: string, args: any[] = []) {
    console.log(`Calling ${functionName}...`)
    const data = encodeFunctionData({ abi, functionName, args })
    const result = await broadcast(INVESTOR_WALLET_ID, contractAddress, data)
    console.log('Tx hash:', result.txHash)
    console.log('Confirmed.\n')
}

async function main() {
    bondAbi = loadAbi('Bond')
    currencyAbi = loadAbi('StableCoin')

    const wallet = await dfnsApi.wallets.getWallet({ walletId: INVESTOR_WALLET_ID })
    const userAddress = wallet.address as `0x${string}`

    bondAddress = await ask('Bond Contract Address: ')
    if (!bondAddress) { rl.close(); return }

    while (true) {
        console.log('\n--- Holder Operations ---')
        console.log('1. View Status')
        console.log('2. Subscribe (Approve + Subscribe)')
        console.log('3. Claim Bond')
        console.log('4. Claim Coupon')
        console.log('5. Redeem')
        console.log('6. Exit')

        const choice = await ask('Select (1-6): ')

        switch (choice) {
            case '1':
                await viewStatus(userAddress)
                break
            case '2': {
                const amountInput = await ask('Subscription Amount (StableCoin): ')
                const amount = parseUnits(amountInput, 6)
                const currencyAddr = await readContract({
                    address: bondAddress, abi: bondAbi, functionName: 'currency',
                }) as string
                await callFn(currencyAddr, currencyAbi, 'approve', [bondAddress, amount])
                await callFn(bondAddress, bondAbi, 'subscribe', [amount])
                break
            }
            case '3':
                await callFn(bondAddress, bondAbi, 'claimBond')
                break
            case '4': {
                console.log('Scanning for claimable coupons...')
                const now = BigInt(Math.floor(Date.now() / 1000))
                let foundAny = false

                for (let i = 1; i <= 400; i++) {
                    const couponIndex = BigInt(i)
                    const couponDate = BigInt(await readContract({
                        address: bondAddress, abi: bondAbi, functionName: 'getCouponDate', args: [couponIndex],
                    }) as string)

                    if (couponDate > now) break

                    const isFunded = await readContract({
                        address: bondAddress, abi: bondAbi, functionName: 'couponFunded', args: [couponIndex],
                    }) as boolean
                    if (!isFunded) {
                        console.log(`Coupon #${i} is NOT FUNDED.`)
                        continue
                    }

                    const isClaimed = await readContract({
                        address: bondAddress, abi: bondAbi, functionName: 'couponClaimed', args: [couponIndex, userAddress],
                    }) as boolean
                    if (isClaimed) continue

                    console.log(`Claiming coupon #${i}...`)
                    foundAny = true
                    await callFn(bondAddress, bondAbi, 'claimCoupon', [couponIndex])
                }

                if (!foundAny) console.log('No claimable coupons found.')
                break
            }
            case '5':
                await callFn(bondAddress, bondAbi, 'redeem')
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
