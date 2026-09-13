// Minimal EIP-1193 wallet helpers for the browser — deliberately no wagmi/viem.
// Only the customer side needs a browser wallet in this blueprint; the
// merchant/spender side stays Dfns-custodied (see ../../facilitator).

const BASE_SEPOLIA_CHAIN_ID_HEX = '0x14a34'; // 84532

export interface EthereumProvider {
    request: (args: { method: string; params?: unknown[] }) => Promise<any>;
    isMetaMask?: boolean;
    providers?: EthereumProvider[];
}

declare global {
    interface Window {
        ethereum?: EthereumProvider;
    }
}

/**
 * Finds MetaMask specifically, even if other wallet extensions are also
 * installed. Multiple injected wallets expose themselves via
 * `window.ethereum.providers` (EIP-5749 style); each entry sets `isMetaMask`
 * if it is MetaMask. Throws if MetaMask isn't found, rather than silently
 * falling back to whichever wallet happens to be the default `window.ethereum`.
 */
export function getProvider(): EthereumProvider {
    if (typeof window === 'undefined' || !window.ethereum) {
        throw new Error('MetaMask not found — install the MetaMask browser extension.');
    }

    const candidates = window.ethereum.providers?.length ? window.ethereum.providers : [window.ethereum];
    const metamask = candidates.find((p) => p.isMetaMask);
    if (!metamask) {
        throw new Error('MetaMask not found — install the MetaMask browser extension.');
    }
    return metamask;
}

export async function connectWallet(): Promise<string> {
    const provider = getProvider();
    const accounts: string[] = await provider.request({ method: 'eth_requestAccounts' });
    if (!accounts[0]) throw new Error('No account returned by wallet');
    await ensureBaseSepolia(provider);
    return accounts[0];
}

async function ensureBaseSepolia(provider: EthereumProvider): Promise<void> {
    const currentChainId: string = await provider.request({ method: 'eth_chainId' });
    if (currentChainId?.toLowerCase() === BASE_SEPOLIA_CHAIN_ID_HEX) return;

    try {
        await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }],
        });
    } catch (err: unknown) {
        const code = (err as { code?: number })?.code;
        if (code === 4902) {
            await provider.request({
                method: 'wallet_addEthereumChain',
                params: [
                    {
                        chainId: BASE_SEPOLIA_CHAIN_ID_HEX,
                        chainName: 'Base Sepolia',
                        rpcUrls: ['https://sepolia.base.org'],
                        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                        blockExplorerUrls: ['https://sepolia.basescan.org'],
                    },
                ],
            });
        } else {
            throw err;
        }
    }
}

/** ERC20 approve(address,uint256) calldata — encoded by hand to avoid a client-side ethers dependency. */
export function encodeApprove(spender: string, amount: bigint): string {
    const selector = '0x095ea7b3';
    const spenderPadded = spender.toLowerCase().replace('0x', '').padStart(64, '0');
    const amountPadded = amount.toString(16).padStart(64, '0');
    return `${selector}${spenderPadded}${amountPadded}`;
}

export async function sendApprove(args: {
    from: string;
    usdcAddress: string;
    spender: string;
    amount: bigint;
}): Promise<string> {
    const provider = getProvider();
    const data = encodeApprove(args.spender, args.amount);
    const txHash: string = await provider.request({
        method: 'eth_sendTransaction',
        params: [{ from: args.from, to: args.usdcAddress, data }],
    });
    return txHash;
}

/** Poll until the approve tx is mined — the facilitator's /sessions needs a confirmed receipt. */
export async function waitForReceipt(txHash: string, timeoutMs = 90_000): Promise<void> {
    const provider = getProvider();
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const receipt = await provider.request({ method: 'eth_getTransactionReceipt', params: [txHash] });
        if (receipt) {
            if (receipt.status === '0x1') return;
            throw new Error(`approve tx ${txHash} reverted`);
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(`timed out waiting for approve tx ${txHash} to be mined`);
}
