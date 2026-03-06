import { encodeFunctionData, parseUnits, formatUnits } from 'viem'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import readline from 'readline'
import { dfnsApi, INVESTOR_WALLET_ID, client } from './dfns.js'

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

async function viewStatus(userAddress: `0x${string}`) {
    console.log('\n--- Portfolio ---')
    console.log(`Address: ${userAddress}`)
    const addr = bondAddress as `0x${string}`

    const balance = await client.readContract({ address: addr, abi: bondAbi, functionName: 'balanceOf', args: [userAddress] })
    const accrued = await client.readContract({ address: addr, abi: bondAbi, functionName: 'accruedInterest', args: [userAddress] }) as bigint
    const totalIssued = await client.readContract({ address: addr, abi: bondAbi, functionName: 'totalBondsIssued' })
    const totalRedeemed = await client.readContract({ address: addr, abi: bondAbi, functionName: 'totalBondsRedeemed' })
    const issuanceDate = await client.readContract({ address: addr, abi: bondAbi, functionName: 'issuanceDate' }) as bigint
    const maturityDate = await client.readContract({ address: addr, abi: bondAbi, functionName: 'maturityDate' }) as bigint
    const timeToNext = await client.readContract({ address: addr, abi: bondAbi, functionName: 'timeToNextCoupon' }) as bigint

    console.log(`Bond Balance: ${balance}`)
    console.log(`Accrued Interest: ${formatUnits(accrued, 6)} EURC`)
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
        walletId: INVESTOR_WALLET_ID,
        body: { kind: 'Eip1559', to: contractAddress, data } as any,
    })

    let txHash = result.txHash
    if (!txHash) {
        console.log('Pending approval, polling...', result.id)
        for (let i = 0; i < 120; i++) {
            await new Promise(r => setTimeout(r, 2000))
            const tx = await dfnsApi.wallets.getTransaction({ walletId: INVESTOR_WALLET_ID, transactionId: result.id })
            if ((tx as any).txHash) { txHash = (tx as any).txHash; break }
            if ((tx as any).status === 'Failed' || (tx as any).status === 'Rejected') throw new Error(`Transaction ${(tx as any).status}`)
        }
        if (!txHash) throw new Error('Transaction timed out')
    }
    console.log('Tx hash:', txHash)
    await client.waitForTransactionReceipt({ hash: txHash as `0x${string}` })
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
                const currencyAddr = await client.readContract({
                    address: bondAddress as `0x${string}`, abi: bondAbi, functionName: 'currency',
                }) as string
                await broadcast(currencyAddr, currencyAbi, 'approve', [bondAddress, amount])
                await broadcast(bondAddress, bondAbi, 'subscribe', [amount])
                break
            }
            case '3':
                await broadcast(bondAddress, bondAbi, 'claimBond')
                break
            case '4': {
                console.log('Scanning for claimable coupons...')
                const now = BigInt(Math.floor(Date.now() / 1000))
                let foundAny = false

                for (let i = 1; i <= 400; i++) {
                    const couponIndex = BigInt(i)
                    const couponDate = await client.readContract({
                        address: bondAddress as `0x${string}`, abi: bondAbi, functionName: 'getCouponDate', args: [couponIndex],
                    }) as bigint

                    if (couponDate > now) break

                    const isFunded = await client.readContract({
                        address: bondAddress as `0x${string}`, abi: bondAbi, functionName: 'couponFunded', args: [couponIndex],
                    }) as boolean
                    if (!isFunded) {
                        console.log(`Coupon #${i} is NOT FUNDED.`)
                        continue
                    }

                    const isClaimed = await client.readContract({
                        address: bondAddress as `0x${string}`, abi: bondAbi, functionName: 'couponClaimed', args: [couponIndex, userAddress],
                    }) as boolean
                    if (isClaimed) continue

                    console.log(`Claiming coupon #${i}...`)
                    foundAny = true
                    await broadcast(bondAddress, bondAbi, 'claimCoupon', [couponIndex])
                }

                if (!foundAny) console.log('No claimable coupons found.')
                break
            }
            case '5':
                await broadcast(bondAddress, bondAbi, 'redeem')
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
