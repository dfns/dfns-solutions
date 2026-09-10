import { DfnsX402Signer } from './dfns-signer';
import { MerchantAPI } from './merchant';

export class AIAgent {
    constructor(
        private dfnsSigner: DfnsX402Signer,
        private merchant: MerchantAPI,
    ) {}

    public async executeTask() {
        console.log('\n--- AI Agent Task Started ---');
        console.log('[Agent] Attempting purchase from merchant...');

        const itemId = 'item-123';
        let response = await this.merchant.purchaseItem(itemId);

        if (response.status === 402) {
            console.log('[Agent] Received HTTP 402 Payment Required.');
            console.log('[Agent] Payment Requirement:', response.paymentRequirement);

            console.log('[Agent] Forwarding requirement to Dfns Signer...');
            const signaturePayload = await this.dfnsSigner.signPayment(response.paymentRequirement);

            const xPaymentHeader = Buffer.from(JSON.stringify(signaturePayload)).toString('base64');
            console.log('[Agent] X-PAYMENT header ready.');

            console.log('[Agent] Retrying purchase with X-PAYMENT header...');
            response = await this.merchant.purchaseItem(itemId, xPaymentHeader, this.dfnsSigner);

            if (response.status === 200) {
                console.log('[Agent] Success!', response.message);
            } else {
                console.log('[Agent] Failed to purchase:', response.error);
            }
        } else {
            console.log('[Agent] Unexpected response:', response);
        }

        console.log('--- AI Agent Task Completed ---\n');
    }
}
