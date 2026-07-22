import * as dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`Missing required env var: ${name}`);
    return v;
}

// Local-testing-only escape hatch: skip Dfns entirely. Either:
//   - LOCAL_MERCHANT_ADDRESS only: /settle returns a fake tx hash, nothing is
//     ever broadcast.
//   - LOCAL_MERCHANT_ADDRESS + MERCHANT_PRIVATE_KEY: /settle broadcasts a REAL
//     transferFrom, signed by that raw private key instead of Dfns. Use a
//     throwaway Base Sepolia key here — never a key holding real funds.
// Never use either outside local development — see dfns-client.ts.
const localMode = process.env.LOCAL_MODE === 'true';

export const config = {
    port: Number(process.env.PORT ?? 4021),
    network: process.env.NETWORK ?? 'base:sepolia',
    networkCaip: process.env.NETWORK_CAIP ?? 'eip155:84532',
    chainId: Number(process.env.CHAIN_ID ?? 84532),
    rpcUrl: process.env.RPC_URL ?? 'https://sepolia.base.org',
    usdcAddress: process.env.USDC_CONTRACT_ADDRESS ?? '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    assetDecimals: Number(process.env.ASSET_DECIMALS ?? 6),

    localMode,
    localMerchantAddress: process.env.LOCAL_MERCHANT_ADDRESS ?? '',
    merchantPrivateKey: process.env.MERCHANT_PRIVATE_KEY ?? '',

    // Only the merchant/spender wallet is Dfns-custodied. The customer's
    // one-time approve is signed by whatever wallet the caller connects
    // (e.g. MetaMask) and submitted to POST /sessions as a tx hash for
    // on-chain verification — see routes/sessions.ts.
    dfnsApiUrl: localMode ? '' : required('DFNS_API_URL'),
    dfnsOrgId: localMode ? '' : required('DFNS_ORG_ID'),
    dfnsAuthToken: localMode ? '' : required('DFNS_AUTH_TOKEN'),
    dfnsCredId: localMode ? '' : required('DFNS_CRED_ID'),
    dfnsPrivateKey: localMode ? '' : required('DFNS_PRIVATE_KEY'),
    merchantWalletId: localMode ? '' : required('DFNS_MERCHANT_WALLET_ID'),
};

if (localMode && !config.localMerchantAddress && !config.merchantPrivateKey) {
    throw new Error('LOCAL_MODE=true requires LOCAL_MERCHANT_ADDRESS or MERCHANT_PRIVATE_KEY to be set');
}
