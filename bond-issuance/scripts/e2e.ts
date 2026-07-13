import { encodeDeployData, encodeFunctionData, parseUnits, formatUnits } from 'viem'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import readline from 'readline'
import { dfnsApi, ISSUER_WALLET_ID, INVESTOR_WALLET_ID, readContract, broadcast as dfnsBroadcast } from './dfns.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = (q: string): Promise<string> => new Promise(resolve => rl.question(q, resolve))

function loadArtifact(name: string) {
    const p = path.join(__dirname, `../artifacts/contracts/${name}.sol/${name}.json`)
    if (!fs.existsSync(p)) throw new Error(`Artifact not found: ${p}. Run 'npm run compile' first.`)
    return JSON.parse(fs.readFileSync(p, 'utf8'))
}

async function broadcast(walletId: string, to: string | undefined, data: string, label: string) {
    console.log(`  Broadcasting: ${label}...`)
    const result = await dfnsBroadcast(walletId, to, data)
    console.log(`  Tx: ${result.txHash}`)
    console.log(`  Confirmed.`)
    return result
}

// DFNS has no API to read back a deployment's resulting contract address, so
// after a deploy tx confirms, pause and ask for the address (look it up via
// the printed Etherscan link) -- same manual pattern the CLI ops scripts use.
async function askDeployedAddress(txHash: string, label: string): Promise<string> {
    console.log(`  Look up the deployed address: https://sepolia.etherscan.io/tx/${txHash}`)
    const address = await ask(`  ${label} contract address: `)
    if (!address) throw new Error(`${label} address is required to continue`)
    return address
}

async function main() {
    const stableCoinArtifact = loadArtifact('StableCoin')
    const bondArtifact = loadArtifact('Bond')

    const issuerWallet = await dfnsApi.wallets.getWallet({ walletId: ISSUER_WALLET_ID })
    const investorWallet = await dfnsApi.wallets.getWallet({ walletId: INVESTOR_WALLET_ID })
    const issuerAddr = issuerWallet.address!
    const investorAddr = investorWallet.address!

    console.log('\n=== Bond Issuance E2E (Sepolia) ===\n')
    console.log(`Issuer:   ${issuerAddr}`)
    console.log(`Investor: ${investorAddr}`)

    // ── 1. Deploy StableCoin ──────────────────────────────────────────
    console.log('\n── Step 1: Deploy StableCoin ──')
    const deployStable = encodeDeployData({
        abi: stableCoinArtifact.abi,
        bytecode: stableCoinArtifact.bytecode,
        args: [issuerAddr, 'Euro Coin', 'EURC'],
    })
    const stableReceipt = await broadcast(ISSUER_WALLET_ID, undefined, deployStable, 'deploy StableCoin')
    const stableCoinAddr = await askDeployedAddress(stableReceipt.txHash, 'StableCoin')
    console.log(`  StableCoin: ${stableCoinAddr}`)

    // ── 2. Mint EURC to investor ──────────────────────────────────────
    console.log('\n── Step 2: Mint 10,000 EURC to investor ──')
    const mintAmount = parseUnits('10000', 6)
    const mintData = encodeFunctionData({
        abi: stableCoinArtifact.abi,
        functionName: 'mint',
        args: [investorAddr, mintAmount],
    })
    await broadcast(ISSUER_WALLET_ID, stableCoinAddr, mintData, 'mint EURC')

    // Also mint some to issuer (for coupon deposits and principal return later)
    console.log('\n── Step 2b: Mint 10,000 EURC to issuer ──')
    const mintIssuerData = encodeFunctionData({
        abi: stableCoinArtifact.abi,
        functionName: 'mint',
        args: [issuerAddr, mintAmount],
    })
    await broadcast(ISSUER_WALLET_ID, stableCoinAddr, mintIssuerData, 'mint EURC to issuer')

    // ── 3. Deploy Bond ────────────────────────────────────────────────
    console.log('\n── Step 3: Deploy Bond ──')
    const notional = parseUnits('100', 6)     // 100 EURC face value
    const apr = 400n                           // 4%
    const frequency = 300n                     // 5 minutes (for demo)
    const maturityDate = BigInt(Math.floor(Date.now() / 1000)) + 3600n  // 1 hour from now

    const deployBond = encodeDeployData({
        abi: bondArtifact.abi,
        bytecode: bondArtifact.bytecode,
        args: ['Demo Bond', 'DB1', stableCoinAddr, notional, apr, frequency, maturityDate, parseUnits('100000', 6)],
    })
    const bondReceipt = await broadcast(ISSUER_WALLET_ID, undefined, deployBond, 'deploy Bond')
    const bondAddr = await askDeployedAddress(bondReceipt.txHash, 'Bond')
    console.log(`  Bond: ${bondAddr}`)
    console.log(`  Notional: 100 EURC | APR: 4% | Coupon: every 5 min | Maturity: 1 hour`)

    // ── 4. Investor subscribes ────────────────────────────────────────
    const subAmount = parseUnits('1000', 6)
    console.log(`\n── Step 4: Investor subscribes ${formatUnits(subAmount, 6)} EURC ──`)

    // Approve
    const approveData = encodeFunctionData({
        abi: stableCoinArtifact.abi,
        functionName: 'approve',
        args: [bondAddr, subAmount],
    })
    await broadcast(INVESTOR_WALLET_ID, stableCoinAddr, approveData, 'approve EURC')

    // Subscribe
    const subscribeData = encodeFunctionData({
        abi: bondArtifact.abi,
        functionName: 'subscribe',
        args: [subAmount],
    })
    await broadcast(INVESTOR_WALLET_ID, bondAddr, subscribeData, 'subscribe')

    // ── 5. Issuer closes issuance ─────────────────────────────────────
    console.log('\n── Step 5: Close issuance ──')
    const closeData = encodeFunctionData({ abi: bondArtifact.abi, functionName: 'closePrimaryIssuance' })
    await broadcast(ISSUER_WALLET_ID, bondAddr, closeData, 'closePrimaryIssuance')

    // ── 6. Issuer withdraws proceeds ──────────────────────────────────
    console.log('\n── Step 6: Withdraw proceeds ──')
    const withdrawData = encodeFunctionData({ abi: bondArtifact.abi, functionName: 'withdrawProceeds' })
    await broadcast(ISSUER_WALLET_ID, bondAddr, withdrawData, 'withdrawProceeds')

    // ── 7. Investor claims bond tokens ────────────────────────────────
    console.log('\n── Step 7: Investor claims bond tokens ──')
    const claimBondData = encodeFunctionData({ abi: bondArtifact.abi, functionName: 'claimBond' })
    await broadcast(INVESTOR_WALLET_ID, bondAddr, claimBondData, 'claimBond')

    const bondBalance = BigInt(await readContract({
        address: bondAddr, abi: bondArtifact.abi, functionName: 'balanceOf', args: [investorAddr],
    }) as string)
    console.log(`  Bond balance: ${bondBalance} (${formatUnits(bondBalance, 6)} bonds)`)

    // ── 8. View status ────────────────────────────────────────────────
    console.log('\n── Step 8: Bond status ──')
    const totalIssued = await readContract({ address: bondAddr, abi: bondArtifact.abi, functionName: 'totalBondsIssued' })
    const accrued = BigInt(await readContract({ address: bondAddr, abi: bondArtifact.abi, functionName: 'accruedInterest', args: [investorAddr] }) as string)
    const timeToNext = await readContract({ address: bondAddr, abi: bondArtifact.abi, functionName: 'timeToNextCoupon' }) as string
    console.log(`  Total bonds issued: ${totalIssued}`)
    console.log(`  Accrued interest: ${formatUnits(accrued, 6)} EURC`)
    console.log(`  Time to next coupon: ${timeToNext} seconds`)

    // ── 9. Deposit & claim coupon ─────────────────────────────────────
    console.log('\n── Step 9: Deposit coupon #1 ──')
    const couponAmount = BigInt(await readContract({ address: bondAddr, abi: bondArtifact.abi, functionName: 'getCouponAmount' }) as string)
    console.log(`  Coupon amount: ${formatUnits(couponAmount, 6)} EURC`)

    // Issuer approves and deposits
    const approveCouponData = encodeFunctionData({
        abi: stableCoinArtifact.abi, functionName: 'approve', args: [bondAddr, couponAmount],
    })
    await broadcast(ISSUER_WALLET_ID, stableCoinAddr, approveCouponData, 'approve coupon')
    const depositCouponData = encodeFunctionData({ abi: bondArtifact.abi, functionName: 'depositCoupon' })
    await broadcast(ISSUER_WALLET_ID, bondAddr, depositCouponData, 'depositCoupon')

    // Wait for coupon date using wall-clock time (no RPC substitute for block
    // timestamp; the difference is immaterial against a coupon schedule).
    const couponDate = BigInt(await readContract({ address: bondAddr, abi: bondArtifact.abi, functionName: 'getCouponDate', args: [1n] }) as string)
    let now = BigInt(Math.floor(Date.now() / 1000))
    while (now <= couponDate) {
        const remaining = Number(couponDate - now)
        console.log(`  Waiting for coupon #1... ${remaining}s remaining`)
        await new Promise(r => setTimeout(r, Math.min(remaining + 15, 30) * 1000))
        now = BigInt(Math.floor(Date.now() / 1000))
    }

    console.log('\n── Step 10: Investor claims coupon #1 ──')
    const claimCouponData = encodeFunctionData({ abi: bondArtifact.abi, functionName: 'claimCoupon', args: [1n] })
    await broadcast(INVESTOR_WALLET_ID, bondAddr, claimCouponData, 'claimCoupon(1)')

    const investorBalance = BigInt(await readContract({
        address: stableCoinAddr, abi: stableCoinArtifact.abi, functionName: 'balanceOf', args: [investorAddr],
    }) as string)
    console.log(`  Investor EURC balance: ${formatUnits(investorBalance, 6)}`)

    // ── Done ──────────────────────────────────────────────────────────
    console.log('\n=== E2E Complete ===')
    console.log(`  StableCoin: ${stableCoinAddr}`)
    console.log(`  Bond:       ${bondAddr}`)
    console.log(`  Etherscan:  https://sepolia.etherscan.io/address/${bondAddr}`)
    rl.close()
}

main().catch(err => { console.error('\nE2E failed:', err); rl.close(); process.exit(1) })
