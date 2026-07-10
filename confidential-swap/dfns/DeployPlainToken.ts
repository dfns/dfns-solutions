import { encodeDeployData } from 'viem'
import {
    BANK_WALLET_ID,
    broadcast,
    getWalletAddress,
    loadArtifact,
    saveDeployment,
} from './DfnsCommon'

const NAME = 'Plain EUR'
const SYMBOL = 'plainEUR'
const DECIMALS = 6

async function main() {
    const bankAddress = await getWalletAddress(BANK_WALLET_ID)
    console.log('Bank (owner):', bankAddress)

    const artifact = loadArtifact('PlainToken')

    console.log(`Deploying ${NAME} (${SYMBOL}, ${DECIMALS} decimals)...`)
    const data = encodeDeployData({
        abi: artifact.abi,
        bytecode: artifact.bytecode,
        args: [bankAddress, NAME, SYMBOL, DECIMALS],
    })

    const receipt = await broadcast(BANK_WALLET_ID, {
        kind: 'Eip1559',
        to: undefined,
        data,
    })

    const plainToken = receipt.contractAddress!
    console.log('PlainToken deployed at:', plainToken)

    saveDeployment({ plainToken, plainTokenName: NAME, plainTokenSymbol: SYMBOL, plainTokenDecimals: DECIMALS })
    console.log('Wrote deployment.json')
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
