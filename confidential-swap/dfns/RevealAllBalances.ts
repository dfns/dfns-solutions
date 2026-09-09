import { erc20Abi, formatUnits, getAddress } from 'viem'
import { DfnsApiClient } from '@dfns/sdk'
import {
    SEPOLIA_CHAIN_ID,
    createFhevmInstance,
    dfnsApi,
    getWalletAddress,
    loadArtifact,
    loadDeployment,
    publicClient,
    walletIdFor,
} from './DfnsCommon'

// usage: npm run reveal:all
//
// Reveals every balance for every token (plainEUR, confSGD, confEUR) for both
// the sender and the receiver, then prints them in a table.
//
// plainEUR  -> plain ERC20.balanceOf
// confSGD   -> encrypted handle, user-decrypted via the relayer
// confEUR   -> encrypted handle, user-decrypted via the relayer
//
// Confidential tokens are decrypted one EIP-712 signature per holder (covering
// both conf tokens at once), signed by that holder's DFNS wallet.

const ROLES = ['sender', 'receiver'] as const
type Role = (typeof ROLES)[number]

const PLAIN_TOKEN = { key: 'plainToken', label: 'plainEUR' } as const
const CONF_TOKENS = [
    { key: 'confSGD', label: 'confSGD' },
    { key: 'confEUR', label: 'confEUR' },
] as const

const CONF_DECIMALS = 6

async function dfnsSignTypedData(
    api: DfnsApiClient,
    walletId: string,
    typedData: {
        domain: Record<string, unknown>
        types: Record<string, { name: string; type: string }[]>
        message: Record<string, unknown>
    },
): Promise<`0x${string}`> {
    const res = await api.wallets.generateSignature({
        walletId,
        body: {
            kind: 'Eip712' as const,
            types: typedData.types,
            domain: typedData.domain,
            message: typedData.message,
        } as any,
    })
    if (!res.signature?.encoded) {
        throw new Error(`DFNS signature failed: ${JSON.stringify(res)}`)
    }
    return res.signature.encoded as `0x${string}`
}

// Read the plain ERC20 balance, formatted to its token units.
async function readPlainBalance(
    tokenAddress: `0x${string}`,
    holderAddress: `0x${string}`,
    decimals: number,
): Promise<string> {
    const balance = (await publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [holderAddress],
    })) as bigint
    return formatUnits(balance, decimals)
}

// User-decrypt every confidential balance for one holder with a single signature.
// Returns a map of token label -> formatted balance string.
async function revealConfidentialBalances(
    walletId: string,
    holderAddress: `0x${string}`,
    tokens: { label: string; address: `0x${string}` }[],
): Promise<Record<string, string>> {
    const out: Record<string, string> = {}

    const abi = loadArtifact('ConfidentialToken').abi
    const entries: { handle: `0x${string}`; token: `0x${string}`; label: string }[] = []
    for (const t of tokens) {
        const handle = (await publicClient.readContract({
            address: t.address,
            abi,
            functionName: 'confidentialBalanceOf',
            args: [holderAddress],
        })) as `0x${string}`
        if (/^0x0+$/.test(handle)) {
            // No encrypted balance yet — nothing to decrypt.
            out[t.label] = formatUnits(0n, CONF_DECIMALS)
        } else {
            entries.push({ handle, token: t.address, label: t.label })
        }
    }

    if (entries.length === 0) return out

    const fhevm = await createFhevmInstance()
    const keypair = fhevm.generateKeypair()
    const startTimestamp = Math.floor(Date.now() / 1000)
    const durationDays = 1
    const contracts = entries.map((e) => e.token)

    const eip712 = fhevm.createEIP712(keypair.publicKey, contracts, startTimestamp, durationDays)
    const { EIP712Domain, ...nonDomainTypes } = eip712.types as any

    const signature = await dfnsSignTypedData(dfnsApi, walletId, {
        domain: {
            name: eip712.domain.name,
            version: eip712.domain.version,
            chainId: SEPOLIA_CHAIN_ID,
            verifyingContract: eip712.domain.verifyingContract,
        },
        types: nonDomainTypes,
        message: eip712.message as Record<string, unknown>,
    })

    const result = await fhevm.userDecrypt(
        entries.map((e) => ({ handle: e.handle, contractAddress: e.token })),
        keypair.privateKey,
        keypair.publicKey,
        signature.replace(/^0x/, ''),
        contracts,
        holderAddress,
        startTimestamp,
        durationDays,
    )

    for (const e of entries) {
        const cleartext = result[e.handle]
        out[e.label] =
            typeof cleartext === 'bigint'
                ? formatUnits(cleartext, CONF_DECIMALS)
                : String(cleartext ?? '?')
    }
    return out
}

async function main() {
    const deployment = loadDeployment()

    const plainAddress = deployment[PLAIN_TOKEN.key]
        ? getAddress(deployment[PLAIN_TOKEN.key])
        : undefined
    const plainDecimals = Number(deployment.plainTokenDecimals ?? 6)
    const confTokens = CONF_TOKENS.filter((t) => deployment[t.key]).map((t) => ({
        label: t.label,
        address: getAddress(deployment[t.key]),
    }))

    // label -> { sender, receiver }
    const balances: Record<string, Record<string, string>> = {}
    const ensureRow = (label: string) => (balances[label] ??= {})

    for (const role of ROLES) {
        const walletId = walletIdFor(role)
        const holderAddress = await getWalletAddress(walletId)
        const col = capitalize(role)

        console.log(`Resolved ${role}: ${holderAddress}`)

        if (plainAddress) {
            ensureRow(PLAIN_TOKEN.label)[col] = await readPlainBalance(
                plainAddress,
                holderAddress,
                plainDecimals,
            )
        }

        if (confTokens.length > 0) {
            console.log(`  decrypting confidential balances for ${role}...`)
            const conf = await revealConfidentialBalances(walletId, holderAddress, confTokens)
            for (const t of confTokens) ensureRow(t.label)[col] = conf[t.label] ?? '?'
        }
    }

    const rows = Object.entries(balances).map(([token, byRole]) => ({
        Token: token,
        Sender: byRole.Sender ?? '-',
        Receiver: byRole.Receiver ?? '-',
    }))

    console.log('\nBalances:')
    console.table(rows)
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
