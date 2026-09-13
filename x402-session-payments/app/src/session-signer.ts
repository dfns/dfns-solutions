import { DfnsApiClient } from '@dfns/sdk';
import { AsymmetricKeySigner } from '@dfns/sdk-keysigner';
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import { SessionConfig, OpenedSession, PaymentRecord, SessionReceipt } from './types';

dotenv.config();

const erc20Interface = new ethers.Interface([
    'function approve(address spender, uint256 amount) returns (bool)',
    'function transferFrom(address from, address to, uint256 amount) returns (bool)',
]);

interface Session {
    customerAddress: string;
    spenderAddress: string;
    budget: bigint;
    spent: bigint;
    recipients: Set<string>;
    maxPerPayment: bigint;
    expiresAt: number;
    approveTxHash: string;
    payments: PaymentRecord[];
    openedAt: number;
    closed: boolean;
}

/**
 * Session-based x402 signer.
 *
 * Bounded delegation in two layers:
 *   1. On-chain (hard):  openSession() broadcasts ONE ERC20 `approve(spender, budget)`
 *      from the customer's Dfns wallet. The token contract itself will revert any
 *      transferFrom that exceeds this allowance — no off-chain bookkeeping can be
 *      tricked into overspending the budget.
 *   2. Off-chain (in-process, defense in depth): recipient whitelist, expiry, and
 *      per-payment cap are checked here, before every wallets.broadcastTransaction
 *      call for a transferFrom settlement. Pair with a Dfns `Wallets:Sign` Policy on
 *      the merchant wallet for server-side enforcement that holds even if this
 *      service is compromised.
 *
 * After the one-time approve, no further signature is ever requested from the
 * customer — every subsequent payment is broadcast from the merchant/facilitator
 * wallet, which is the only party authorized to call transferFrom.
 */
export class SessionSigner {
    private dfnsApi: DfnsApiClient;
    private customerWalletId: string;
    private merchantWalletId: string;
    private usdcContract: string;
    private customerAddress = '';
    private merchantAddress = '';
    private sessions = new Map<string, Session>();

    constructor() {
        const signer = new AsymmetricKeySigner({
            credId: process.env.DFNS_CRED_ID!,
            privateKey: process.env.DFNS_PRIVATE_KEY!,
        });

        this.dfnsApi = new DfnsApiClient({
            orgId: process.env.DFNS_ORG_ID!,
            authToken: process.env.DFNS_AUTH_TOKEN!,
            baseUrl: process.env.DFNS_API_URL!,
            signer,
        });

        if (!process.env.DFNS_CUSTOMER_WALLET_ID) throw new Error('DFNS_CUSTOMER_WALLET_ID is required');
        if (!process.env.DFNS_MERCHANT_WALLET_ID) throw new Error('DFNS_MERCHANT_WALLET_ID is required');
        if (!process.env.USDC_CONTRACT_ADDRESS) throw new Error('USDC_CONTRACT_ADDRESS is required');

        this.customerWalletId = process.env.DFNS_CUSTOMER_WALLET_ID;
        this.merchantWalletId = process.env.DFNS_MERCHANT_WALLET_ID;
        this.usdcContract = process.env.USDC_CONTRACT_ADDRESS;
    }

    private async resolveWallets() {
        if (this.customerAddress && this.merchantAddress) return;

        const [customer, merchant] = await Promise.all([
            this.dfnsApi.wallets.getWallet({ walletId: this.customerWalletId }),
            this.dfnsApi.wallets.getWallet({ walletId: this.merchantWalletId }),
        ]);
        this.customerAddress = customer.address!;
        this.merchantAddress = merchant.address!;
        console.log(
            `[Session Signer] Customer ${this.customerAddress} · Facilitator/spender ${this.merchantAddress}`,
        );
    }

    private async broadcast(walletId: string, data: string): Promise<string> {
        const result = await this.dfnsApi.wallets.broadcastTransaction({
            walletId,
            body: {
                kind: 'Eip1559',
                to: this.usdcContract,
                data,
                value: '0',
                gasLimit: '100000',
                maxFeePerGas: '5000000000',
                maxPriorityFeePerGas: '1000000000',
            } as any,
        });
        return result.txHash!;
    }

    /** Sign once: broadcast the ERC20 approve that opens the session's on-chain budget cap. */
    public async openSession(config: SessionConfig): Promise<OpenedSession> {
        await this.resolveWallets();

        const budget = BigInt(config.budget);
        const recipients = config.recipients.map((r) => ethers.getAddress(r));
        const expiresAt = Math.floor(Date.now() / 1000) + config.ttlSeconds;

        console.log(
            `[Session Signer] Opening session: budget=${config.budget}, recipients=${recipients.join(',')}, ttl=${config.ttlSeconds}s`,
        );
        console.log(`[Session Signer] Broadcasting approve(${this.merchantAddress}, ${budget}) from customer wallet...`);

        const calldata = erc20Interface.encodeFunctionData('approve', [this.merchantAddress, budget]);
        const approveTxHash = await this.broadcast(this.customerWalletId, calldata);
        const sessionId = ethers.hexlify(ethers.randomBytes(16));

        this.sessions.set(sessionId, {
            customerAddress: this.customerAddress,
            spenderAddress: this.merchantAddress,
            budget,
            spent: 0n,
            recipients: new Set(recipients),
            maxPerPayment: BigInt(config.maxPerPayment),
            expiresAt,
            approveTxHash,
            payments: [],
            openedAt: Math.floor(Date.now() / 1000),
            closed: false,
        });

        console.log(`[Session Signer] Session ${sessionId} open. Approve tx: ${approveTxHash}`);

        return {
            sessionId,
            customer: this.customerAddress,
            spender: this.merchantAddress,
            budget: config.budget,
            recipients,
            maxPerPayment: config.maxPerPayment,
            expiresAt,
            approveTxHash,
        };
    }

    /**
     * Check the payment against the session envelope, then broadcast
     * transferFrom(customer, recipient, amount) from the merchant wallet.
     * Throws (without touching the chain) if any bound is violated.
     */
    public async pay(sessionId: string, itemId: string, amount: string, recipient: string): Promise<string> {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error(`Unknown session ${sessionId}`);
        if (session.closed) throw new Error(`Session ${sessionId} is closed`);

        const now = Math.floor(Date.now() / 1000);
        if (now > session.expiresAt) {
            throw new Error(`Session ${sessionId} expired at ${new Date(session.expiresAt * 1000).toISOString()}`);
        }

        const to = ethers.getAddress(recipient);
        if (!session.recipients.has(to)) {
            throw new Error(`Recipient ${to} is not in the session's approved recipient list`);
        }

        const value = BigInt(amount);
        if (value > session.maxPerPayment) {
            throw new Error(`Payment ${value} exceeds per-payment cap of ${session.maxPerPayment}`);
        }
        if (session.spent + value > session.budget) {
            throw new Error(
                `Payment ${value} would exceed session budget: spent=${session.spent}, budget=${session.budget}, remaining=${session.budget - session.spent}`,
            );
        }

        console.log(`[Session Signer] [${sessionId}] Envelope OK for "${itemId}" (${amount} -> ${to}). Broadcasting transferFrom...`);

        const calldata = erc20Interface.encodeFunctionData('transferFrom', [session.customerAddress, to, value]);
        const txHash = await this.broadcast(this.merchantWalletId, calldata);

        session.spent += value;
        session.payments.push({ itemId, amount, recipient: to, txHash, timestamp: now });

        console.log(`[Session Signer] [${sessionId}] "${itemId}" settled. Tx: ${txHash}. Spent ${session.spent}/${session.budget}`);

        return txHash;
    }

    /** Close the session, releasing any unused budget, and return a full receipt. */
    public closeSession(sessionId: string): SessionReceipt {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error(`Unknown session ${sessionId}`);

        session.closed = true;
        const closedAt = Math.floor(Date.now() / 1000);

        const receipt: SessionReceipt = {
            sessionId,
            budget: session.budget.toString(),
            totalSpent: session.spent.toString(),
            remainingBudget: (session.budget - session.spent).toString(),
            payments: session.payments,
            openedAt: session.openedAt,
            closedAt,
            approveTxHash: session.approveTxHash,
        };

        console.log(`[Session Signer] Session ${sessionId} closed. Spent ${receipt.totalSpent}/${receipt.budget}.`);
        return receipt;
    }
}
