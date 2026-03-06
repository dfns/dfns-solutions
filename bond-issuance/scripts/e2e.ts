import { encodeDeployData, encodeFunctionData, parseUnits, formatUnits } from 'viem'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dfnsApi, ISSUER_WALLET_ID, INVESTOR_WALLET_ID, client } from './dfns.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadArtifact(name: string) {
    const p = path.join(__dirname, `../artifacts/contracts/${name}.sol/${name}.json`)
    if (!fs.existsSync(p)) throw new Error(`Artifact not found: ${p}. Run 'npm run compile' first.`)
    return JSON.parse(fs.readFileSync(p, 'utf8'))
}

async function waitForTx(walletId: string, txId: string): Promise<string> {
    for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 2000))
        const tx = await dfnsApi.wallets.getTransaction({ walletId, transactionId: txId })
        if ((tx as any).txHash) return (tx as any).txHash
        if ((tx as any).status === 'Failed' || (tx as any).status === 'Rejected') {
            throw new Error(`Transaction ${(tx as any).status}: ${(tx as any).reason || txId}`)
        }
    }
    throw new Error('Transaction timed out waiting for approval')
}

async function broadcast(walletId: string, to: string | undefined, data: string, label: string) {
    console.log(`  Broadcasting: ${label}...`)
    const result = await dfnsApi.wallets.broadcastTransaction({
        walletId,
        body: { kind: 'Eip1559', to, data } as any,
    })
    let txHash = result.txHash
    if (!txHash) {
        console.log(`  Pending approval (${result.id}), polling...`)
        txHash = await waitForTx(walletId, result.id)
    }
    console.log(`  Tx: ${txHash}`)
    const receipt = await client.waitForTransactionReceipt({ hash: txHash as `0x${string}` })
    console.log(`  Confirmed in block ${receipt.blockNumber}`)
    return receipt
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
    const stableCoinAddr = stableReceipt.contractAddress!
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
    const currentBlock = await client.getBlock()
    const maturityDate = currentBlock.timestamp + 3600n  // 1 hour from now

    const deployBond = encodeDeployData({
        abi: bondArtifact.abi,
        bytecode: bondArtifact.bytecode,
        args: ['Demo Bond', 'DB1', stableCoinAddr, notional, apr, frequency, maturityDate, parseUnits('100000', 6)],
    })
    const bondReceipt = await broadcast(ISSUER_WALLET_ID, undefined, deployBond, 'deploy Bond')
    const bondAddr = bondReceipt.contractAddress!
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

    const bondBalance = await client.readContract({
        address: bondAddr as `0x${string}`, abi: bondArtifact.abi, functionName: 'balanceOf', args: [investorAddr],
    }) as bigint
    console.log(`  Bond balance: ${bondBalance} (${formatUnits(bondBalance, 6)} bonds)`)

    // ── 8. View status ────────────────────────────────────────────────
    console.log('\n── Step 8: Bond status ──')
    const totalIssued = await client.readContract({ address: bondAddr as `0x${string}`, abi: bondArtifact.abi, functionName: 'totalBondsIssued' })
    const accrued = await client.readContract({ address: bondAddr as `0x${string}`, abi: bondArtifact.abi, functionName: 'accruedInterest', args: [investorAddr] }) as bigint
    const timeToNext = await client.readContract({ address: bondAddr as `0x${string}`, abi: bondArtifact.abi, functionName: 'timeToNextCoupon' }) as bigint
    console.log(`  Total bonds issued: ${totalIssued}`)
    console.log(`  Accrued interest: ${formatUnits(accrued, 6)} EURC`)
    console.log(`  Time to next coupon: ${timeToNext} seconds`)

    // ── 9. Deposit & claim coupon ─────────────────────────────────────
    console.log('\n── Step 9: Deposit coupon #1 ──')
    const couponAmount = await client.readContract({ address: bondAddr as `0x${string}`, abi: bondArtifact.abi, functionName: 'getCouponAmount' }) as bigint
    console.log(`  Coupon amount: ${formatUnits(couponAmount, 6)} EURC`)

    // Issuer approves and deposits
    const approveCouponData = encodeFunctionData({
        abi: stableCoinArtifact.abi, functionName: 'approve', args: [bondAddr, couponAmount],
    })
    await broadcast(ISSUER_WALLET_ID, stableCoinAddr, approveCouponData, 'approve coupon')
    const depositCouponData = encodeFunctionData({ abi: bondArtifact.abi, functionName: 'depositCoupon' })
    await broadcast(ISSUER_WALLET_ID, bondAddr, depositCouponData, 'depositCoupon')

    // Wait for coupon date using on-chain time (block timestamp), not Date.now()
    const couponDate = await client.readContract({ address: bondAddr as `0x${string}`, abi: bondArtifact.abi, functionName: 'getCouponDate', args: [1n] }) as bigint
    let block = await client.getBlock()
    while (block.timestamp <= couponDate) {
        const remaining = Number(couponDate - block.timestamp)
        console.log(`  Waiting for coupon #1... ${remaining}s remaining (block time)`)
        await new Promise(r => setTimeout(r, Math.min(remaining + 15, 30) * 1000))
        block = await client.getBlock()
    }

    console.log('\n── Step 10: Investor claims coupon #1 ──')
    const claimCouponData = encodeFunctionData({ abi: bondArtifact.abi, functionName: 'claimCoupon', args: [1n] })
    await broadcast(INVESTOR_WALLET_ID, bondAddr, claimCouponData, 'claimCoupon(1)')

    const investorBalance = await client.readContract({
        address: stableCoinAddr as `0x${string}`, abi: stableCoinArtifact.abi, functionName: 'balanceOf', args: [investorAddr],
    }) as bigint
    console.log(`  Investor EURC balance: ${formatUnits(investorBalance, 6)}`)

    // ── Done ──────────────────────────────────────────────────────────
    console.log('\n=== E2E Complete ===')
    console.log(`  StableCoin: ${stableCoinAddr}`)
    console.log(`  Bond:       ${bondAddr}`)
    console.log(`  Etherscan:  https://sepolia.etherscan.io/address/${bondAddr}`)
}

main().catch(err => { console.error('\nE2E failed:', err); process.exit(1) })
