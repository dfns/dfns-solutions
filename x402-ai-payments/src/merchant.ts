import { ethers } from 'ethers';
import { PaymentRequirement, PaymentSignature } from './types';
import { DfnsX402Signer } from './dfns-signer';

export class MerchantAPI {
    private merchantAddress: string;
    private usdcContract: string;
    private chainId: number;

    constructor() {
        if (!process.env.MERCHANT_ADDRESS) throw new Error('MERCHANT_ADDRESS is required');
        if (!process.env.USDC_CONTRACT_ADDRESS) throw new Error('USDC_CONTRACT_ADDRESS is required');
        if (!process.env.CHAIN_ID) throw new Error('CHAIN_ID is required');

        this.merchantAddress = process.env.MERCHANT_ADDRESS;
        this.usdcContract = process.env.USDC_CONTRACT_ADDRESS;
        this.chainId = parseInt(process.env.CHAIN_ID, 10);

        console.log(`[Merchant] Initialized on chain ${this.chainId}`);
    }

    public async purchaseItem(
        itemId: string,
        xPaymentHeader?: string,
        facilitator?: DfnsX402Signer,
    ): Promise<any> {
        console.log(`[Merchant] Purchase request for item ${itemId}`);
        const price = '1000000'; // 1.00 USDC (6 decimals)

        if (!xPaymentHeader) {
            console.log('[Merchant] No X-PAYMENT header. Returning 402 Payment Required.');
            const req: PaymentRequirement = {
                amount: price,
                asset: 'USDC',
                chainId: this.chainId,
                recipient: this.merchantAddress,
                contract: this.usdcContract,
                nonce: ethers.hexlify(ethers.randomBytes(32)),
                validAfter: 0,
                validBefore: Math.floor(Date.now() / 1000) + 3600,
            };
            return { status: 402, paymentRequirement: req };
        }

        console.log('[Merchant] X-PAYMENT header found. Verifying signature...');
        const payload: PaymentSignature = JSON.parse(
            Buffer.from(xPaymentHeader, 'base64').toString('utf-8'),
        );

        if (payload.protocol !== 'EIP-3009') {
            return { status: 400, error: `Unsupported protocol: ${payload.protocol}` };
        }

        const domain = {
            name: 'USDC',
            version: '2',
            chainId: this.chainId,
            verifyingContract: this.usdcContract,
        };

        const types = {
            ReceiveWithAuthorization: [
                { name: 'from', type: 'address' },
                { name: 'to', type: 'address' },
                { name: 'value', type: 'uint256' },
                { name: 'validAfter', type: 'uint256' },
                { name: 'validBefore', type: 'uint256' },
                { name: 'nonce', type: 'bytes32' },
            ],
        };

        const recovered = ethers.verifyTypedData(domain, types, payload.message, payload.signature);
        if (recovered.toLowerCase() !== payload.message.from.toLowerCase()) {
            return { status: 401, error: 'Invalid signature' };
        }

        console.log(`[Merchant] Signature verified. Signer: ${recovered}`);

        if (!facilitator) {
            return { status: 200, message: `Verified item ${itemId} (no on-chain settlement)` };
        }

        console.log('[Merchant] Submitting settlement via Dfns facilitator...');
        const txHash = await facilitator.settlePayment(this.usdcContract, payload);
        return {
            status: 200,
            message: `Purchased item ${itemId}. Tx: ${txHash}`,
        };
    }
}
