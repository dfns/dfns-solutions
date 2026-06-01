import { encodeDeployData } from 'viem'
import {
    BANK_WALLET_ID,
    broadcast,
    getWalletAddress,
    loadArtifact,
    saveDeployment,
} from './DfnsCommon'

async function main() {
    const bankAddress = await getWalletAddress(BANK_WALLET_ID)
    console.log('Bank (owner):', bankAddress)

    const artifact = loadArtifact('ConfidentialSwap')

    console.log('Deploying ConfidentialSwap...')
    const data = encodeDeployData({
        abi: artifact.abi,
        bytecode: artifact.bytecode,
        args: [bankAddress],
    })

    const receipt = await broadcast(BANK_WALLET_ID, {
        kind: 'Eip1559',
        to: undefined,
        data,
    })

    const swap = receipt.contractAddress!
    console.log('ConfidentialSwap deployed at:', swap)

    saveDeployment({ swap })
    console.log('Wrote deployment.json')
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
