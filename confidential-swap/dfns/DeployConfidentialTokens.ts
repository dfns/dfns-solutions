import { encodeDeployData } from 'viem'
import {
    BANK_WALLET_ID,
    broadcast,
    getWalletAddress,
    loadArtifact,
    saveDeployment,
} from './DfnsCommon'

// We deploy two confidential tokens so the demo can show both
// ERC7984 <-> ERC20 swaps (confSGD) and ERC7984 <-> ERC7984 swaps (confSGD + confEUR).
const TOKENS = [
    { key: 'confSGD' as const, name: 'Confidential SGD', symbol: 'confSGD', uri: '' },
    { key: 'confEUR' as const, name: 'Confidential EUR', symbol: 'confEUR', uri: '' },
]

async function main() {
    const bankAddress = await getWalletAddress(BANK_WALLET_ID)
    console.log('Bank (owner):', bankAddress)

    const artifact = loadArtifact('ConfidentialToken')

    for (const t of TOKENS) {
        console.log(`\nDeploying ${t.name} (${t.symbol})...`)
        const data = encodeDeployData({
            abi: artifact.abi,
            bytecode: artifact.bytecode,
            args: [bankAddress, t.name, t.symbol, t.uri],
        })

        const receipt = await broadcast(BANK_WALLET_ID, {
            kind: 'Eip1559',
            to: undefined,
            data,
        })

        const address = receipt.contractAddress!
        console.log(`${t.symbol} deployed at:`, address)

        saveDeployment({ [t.key]: address, [`${t.key}Symbol`]: t.symbol, [`${t.key}Name`]: t.name })
    }
    console.log('\nWrote deployment.json')
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
