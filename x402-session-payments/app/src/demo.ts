import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import { SessionSigner } from './session-signer';
import { MerchantAPI } from './merchant';
import { SessionAgent } from './agent';
import { SessionConfig } from './types';

dotenv.config();

async function main() {
    console.log('=========================================');
    console.log('   Dfns X402 Session Payments Demo       ');
    console.log('=========================================\n');

    const merchantAddress = process.env.MERCHANT_ADDRESS!;

    const signer = new SessionSigner();
    const merchant = new MerchantAPI();
    const agent = new SessionAgent(signer, merchant);

    const config: SessionConfig = {
        budget: '4000000', // 4.00 USDC session budget
        recipients: [merchantAddress],
        ttlSeconds: 3600, // 1 hour
        maxPerPayment: '2000000', // 2.00 USDC per-payment cap
    };

    const session = await agent.openSession(config);

    // A 50-message chatbot session would repeat this loop 50 times with zero
    // additional user interaction. Five messages here keep the demo's on-chain
    // footprint (and testnet gas) small while still showing every enforcement path.
    const messages = [
        { id: 'chat-msg-1', price: '1000000' }, // 1.00 USDC — ok (spent 1.00/4.00)
        { id: 'chat-msg-2', price: '1000000' }, // 1.00 USDC — ok (spent 2.00/4.00)
        { id: 'chat-msg-3', price: '1500000' }, // 1.50 USDC — ok (spent 3.50/4.00)
        { id: 'chat-msg-4', price: '1000000' }, // 1.00 USDC — DENIED: exceeds remaining budget
        { id: 'chat-msg-5', price: '3000000' }, // 3.00 USDC — DENIED: exceeds per-payment cap
    ];

    for (const msg of messages) {
        try {
            await agent.sendMessage(session.sessionId, msg.id, msg.price);
        } catch (err: any) {
            console.log(`[Agent] "${msg.id}" DENIED: ${err.message}`);
        }
    }

    console.log('\n[Demo] Simulating a rogue payment request to an unapproved recipient...');
    try {
        await signer.pay(session.sessionId, 'rogue-item', '500000', ethers.Wallet.createRandom().address);
    } catch (err: any) {
        console.log(`[Demo] Rogue payment DENIED as expected: ${err.message}`);
    }

    const receipt = signer.closeSession(session.sessionId);
    console.log('\n[Demo] Session closed. Receipt:');
    console.log(JSON.stringify(receipt, null, 2));
    console.log('\n--- Demo Complete ---\n');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
