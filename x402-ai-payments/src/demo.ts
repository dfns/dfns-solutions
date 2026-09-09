import { DfnsX402Signer } from './dfns-signer';
import { MerchantAPI } from './merchant';
import { AIAgent } from './agent';

async function main() {
    console.log('=========================================');
    console.log('   Dfns X402 Integration Demo            ');
    console.log('=========================================\n');

    const dfnsSigner = new DfnsX402Signer();
    const merchant = new MerchantAPI();
    const agent = new AIAgent(dfnsSigner, merchant);

    await agent.executeTask();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
