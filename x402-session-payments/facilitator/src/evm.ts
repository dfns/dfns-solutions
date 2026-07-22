import { ethers } from 'ethers';
import { config } from './config';

const erc20Interface = new ethers.Interface([
    'function approve(address spender, uint256 amount) returns (bool)',
    'function transferFrom(address from, address to, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
]);

export const provider = new ethers.JsonRpcProvider(config.rpcUrl);

export function encodeApprove(spender: string, amount: bigint): string {
    return erc20Interface.encodeFunctionData('approve', [ethers.getAddress(spender), amount]);
}

export function encodeTransferFrom(from: string, to: string, amount: bigint): string {
    return erc20Interface.encodeFunctionData('transferFrom', [
        ethers.getAddress(from),
        ethers.getAddress(to),
        amount,
    ]);
}

export function getNowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

const APPROVAL_EVENT_TOPIC = ethers.id('Approval(address,address,uint256)');

/**
 * Confirm a client-submitted tx hash exists, succeeded, and actually granted
 * an ERC20 allowance of at least `minValue` from `expectedFrom` to
 * `expectedSpender` on `expectedAsset`. Throws on any mismatch. Also reads
 * live `allowance()` as defense in depth — the tx receipt alone doesn't
 * prove the allowance wasn't since reduced.
 *
 * Deliberately does NOT assume a plain EOA transaction shape (top-level
 * `to` = the ERC20 contract, top-level `from` = the approving address).
 * Smart-account wallets (e.g. MetaMask's delegation/smart-account feature)
 * route the call through their own infrastructure — the top-level `to`
 * becomes a delegation/relay contract and `from` becomes an internal
 * executor, neither of which is the ERC20 contract or the actual approver.
 * Instead this reads the `Approval(owner, spender, value)` event the ERC20
 * contract itself emitted, which is true regardless of how the call reached
 * it — plain EOA, smart account, or otherwise.
 */
export async function assertApprovalTx(args: {
    txHash: string;
    expectedAsset: string;
    expectedSpender: string;
    expectedFrom: string;
    minValue: bigint;
}): Promise<void> {
    const receipt = await provider.getTransactionReceipt(args.txHash);
    if (!receipt) throw new Error(`approval tx ${args.txHash} not found (not yet mined?)`);
    if (receipt.status !== 1) throw new Error(`approval tx ${args.txHash} not successful (status=${receipt.status})`);

    const approvalLog = receipt.logs.find(
        (log) => log.address.toLowerCase() === args.expectedAsset.toLowerCase() && log.topics[0] === APPROVAL_EVENT_TOPIC,
    );
    if (!approvalLog) {
        throw new Error(`approval tx ${args.txHash} did not emit an Approval event on ${args.expectedAsset}`);
    }

    const owner = ethers.getAddress(`0x${approvalLog.topics[1].slice(-40)}`);
    const spender = ethers.getAddress(`0x${approvalLog.topics[2].slice(-40)}`);
    const value = BigInt(approvalLog.data);

    if (owner.toLowerCase() !== args.expectedFrom.toLowerCase()) {
        throw new Error(`approval tx ${args.txHash} approved from ${owner}, expected ${args.expectedFrom}`);
    }
    if (spender.toLowerCase() !== args.expectedSpender.toLowerCase()) {
        throw new Error(`approval tx ${args.txHash} approved spender ${spender}, expected ${args.expectedSpender}`);
    }
    if (value < args.minValue) {
        throw new Error(`approval tx ${args.txHash} approved ${value} < required cap ${args.minValue}`);
    }

    const erc20 = new ethers.Contract(args.expectedAsset, erc20Interface, provider);
    const onChainAllowance: bigint = await erc20.allowance(owner, args.expectedSpender);
    if (onChainAllowance < args.minValue) {
        throw new Error(`on-chain allowance ${onChainAllowance} is less than claimed cap ${args.minValue}`);
    }
}
