import { encodeDeployData } from 'viem'
import {
    BANK_WALLET_ID,
    broadcast,
    getWalletAddress,
    loadArtifact,
    saveDeployment,
} from './DfnsCommon'

const NAME = 'Confidential USD'
const SYMBOL = 'cUSD'
const URI = ''

async function main() {
    const bankAddress = await getWalletAddress(BANK_WALLET_ID)
    console.log('Bank (owner):', bankAddress)

    const artifact = loadArtifact('ConfidentialToken')

    console.log(`Deploying ${NAME} (${SYMBOL})...`)
    const data = encodeDeployData({
        abi: artifact.abi,
        bytecode: artifact.bytecode,
        args: [bankAddress, NAME, SYMBOL, URI],
    })

    const receipt = await broadcast(BANK_WALLET_ID, {
        kind: 'Eip1559',
        to: undefined,
        data,
    })

    const tokenAddress = receipt.contractAddress!
    console.log('ConfidentialToken deployed at:', tokenAddress)

    saveDeployment({
        token: tokenAddress,
        name: NAME,
        symbol: SYMBOL,
        owner: bankAddress,
    })
    console.log('Wrote deployment.json')
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
