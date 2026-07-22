import { SessionSigner } from './session-signer';
import { MerchantAPI } from './merchant';
import { SessionConfig, OpenedSession } from './types';

export class SessionAgent {
    constructor(
        private signer: SessionSigner,
        private merchant: MerchantAPI,
    ) {}

    public async openSession(config: SessionConfig): Promise<OpenedSession> {
        const session = await this.signer.openSession(config);
        console.log(`[Agent] Session opened with ONE signature (the approve tx). sessionId=${session.sessionId}\n`);
        return session;
    }

    public async sendMessage(sessionId: string, itemId: string, price: string): Promise<void> {
        console.log(`[Agent] Sending "${itemId}" (no user interaction)...`);

        let response = await this.merchant.request(itemId, price, undefined, this.signer);

        if (response.status === 402) {
            response = await this.merchant.request(itemId, price, sessionId, this.signer);
        }

        if (response.status !== 200) {
            throw new Error(response.error || `Unexpected status ${response.status}`);
        }

        console.log(`[Agent] "${itemId}" -> ${response.message}`);
    }
}
