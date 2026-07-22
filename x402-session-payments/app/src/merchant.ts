import { SessionSigner } from './session-signer';

export class MerchantAPI {
    private merchantAddress: string;

    constructor() {
        if (!process.env.MERCHANT_ADDRESS) throw new Error('MERCHANT_ADDRESS is required');
        this.merchantAddress = process.env.MERCHANT_ADDRESS;
        console.log(`[Merchant] Initialized. Recipient: ${this.merchantAddress}`);
    }

    public async request(
        itemId: string,
        price: string,
        sessionId: string | undefined,
        signer: SessionSigner,
    ): Promise<any> {
        console.log(`[Merchant] Request for ${itemId} (price ${price})`);

        if (!sessionId) {
            console.log('[Merchant] No session attached. Returning 402 Payment Required.');
            return {
                status: 402,
                paymentRequirement: { amount: price, recipient: this.merchantAddress, itemId },
            };
        }

        try {
            const txHash = await signer.pay(sessionId, itemId, price, this.merchantAddress);
            return { status: 200, message: `Paid for ${itemId}. Tx: ${txHash}` };
        } catch (err: any) {
            return { status: 402, error: err.message };
        }
    }
}
