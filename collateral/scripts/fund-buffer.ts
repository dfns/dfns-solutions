// Sends the borrower vault a small PYUSD buffer from the lender vault. The
// borrower only ever receives the principal, so without it they couldn't pay
// interest. Like any deposit it lands Quarantined: accept it in the UI.
import { parseUnits, formatUnits } from 'viem'
import { requireEnv } from '../src/env.js'
import { config } from '../src/config.js'
import { getVaultAddress, vaultTransfer, loanAssetTid } from '../src/vault.js'

requireEnv('LENDER_VAULT_ID', 'BORROWER_VAULT_ID')
if (!config.loanAsset.contract) throw new Error('Set PYUSD_CONTRACT in .env')

async function main() {
    const amount = parseUnits(String(config.borrowerPyusdBuffer), config.loanAsset.decimals)
    const { address } = await getVaultAddress('borrower')
    console.log(`Sending ${formatUnits(amount, config.loanAsset.decimals)} ${config.loanAsset.symbol} to the borrower vault ${address}...`)
    const done = await vaultTransfer('lender', { tid: loanAssetTid(), to: address, amount, title: 'borrower PYUSD buffer' })
    console.log(`Confirmed: https://sepolia.etherscan.io/tx/${done.txHash}`)
}

main().catch(e => {
    console.error(e)
    process.exit(1)
})
