import { DfnsApiClient } from '@dfns/sdk';
import { AsymmetricKeySigner } from '@dfns/sdk-keysigner';
import { ethers } from 'ethers';
import { randomBytes } from 'node:crypto';
import { config } from './config';
import { provider } from './evm';

let dfnsApi: DfnsApiClient | null = null;
let merchantWallet: ethers.Wallet | null = null;

if (config.localMode && config.merchantPrivateKey) {
    // Real signing, no Dfns: a raw private key stands in for the merchant
    // wallet so /settle can broadcast actual transferFrom calls while testing
    // locally. Never use this outside local development.
    merchantWallet = new ethers.Wallet(config.merchantPrivateKey, provider);
} else if (!config.localMode) {
    const signer = new AsymmetricKeySigner({
        credId: config.dfnsCredId,
        privateKey: config.dfnsPrivateKey,
    });
    dfnsApi = new DfnsApiClient({
        orgId: config.dfnsOrgId,
        authToken: config.dfnsAuthToken,
        baseUrl: config.dfnsApiUrl,
        signer,
    });
}

let merchantAddress = '';

/** The merchant/spender wallet. Dfns-custodied normally; a raw key or fixed address in LOCAL_MODE. */
export async function resolveMerchantWallet(): Promise<{ merchantAddress: string }> {
    if (merchantWallet) {
        return { merchantAddress: merchantWallet.address };
    }
    if (config.localMode) {
        return { merchantAddress: config.localMerchantAddress };
    }

    if (merchantAddress) return { merchantAddress };

    const merchant = await dfnsApi!.wallets.getWallet({ walletId: config.merchantWalletId });
    merchantAddress = merchant.address!;
    return { merchantAddress };
}

/**
 * Broadcast a contract call as the merchant (every transferFrom settlement).
 * Three paths:
 *   - Real Dfns (default): broadcasts via wallets.broadcastTransaction.
 *   - LOCAL_MODE + MERCHANT_PRIVATE_KEY: broadcasts for real via a plain
 *     ethers.Wallet — no Dfns, but a genuine on-chain transferFrom.
 *   - LOCAL_MODE without a private key: nothing is signed or broadcast; a fake
 *     tx hash is returned so the session/pull flow can still be exercised.
 */
export async function broadcastFromMerchant(to: string, data: string): Promise<string> {
    if (merchantWallet) {
        console.log(
            `[Facilitator] LOCAL_MODE (private key): broadcasting REAL tx from ${merchantWallet.address} (to=${to})...`,
        );
        const tx = await merchantWallet.sendTransaction({ to, data });
        return tx.hash;
    }

    if (config.localMode) {
        const fakeTxHash = `0x${randomBytes(32).toString('hex')}`;
        console.log(
            `[Facilitator] LOCAL_MODE: skipping real broadcast of transferFrom (to=${to}, data=${data}). Returning fake tx hash ${fakeTxHash}`,
        );
        return fakeTxHash;
    }

    const result = await dfnsApi!.wallets.broadcastTransaction({
        walletId: config.merchantWalletId,
        body: {
            kind: 'Eip1559',
            to,
            data,
            value: '0',
            gasLimit: '100000',
            maxFeePerGas: '5000000000',
            maxPriorityFeePerGas: '1000000000',
        } as any,
    });
    return result.txHash!;
}
