import { DfnsApiClient } from '@dfns/sdk';
import { AsymmetricKeySigner } from '@dfns/sdk-keysigner';
import { ethers } from 'ethers';
import { PaymentRequirement, PaymentSignature } from './types';
import * as dotenv from 'dotenv';

dotenv.config();

// Per-payment cap enforced by the signer before generating a signature.
// 5.00 USDC (6 decimals). Combine with a Dfns `Wallets:Sign` Policy in
// production for time-windowed limits and on-chain enforcement.
const MAX_PAYMENT_AMOUNT = 5_000_000n;

export class DfnsX402Signer {
    private dfnsApi: DfnsApiClient;
    private customerWalletId: string;
    private merchantWalletId: string;
    private customerWalletAddress: string = '';

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

        this.customerWalletId = process.env.DFNS_CUSTOMER_WALLET_ID;
        this.merchantWalletId = process.env.DFNS_MERCHANT_WALLET_ID;
    }

    private async resolveCustomerWallet() {
        if (this.customerWalletAddress) return;

        const wallet = await this.dfnsApi.wallets.getWallet({ walletId: this.customerWalletId });
        this.customerWalletAddress = wallet.address!;
        console.log(
            `[Dfns Signer] Customer wallet ${this.customerWalletId} (${this.customerWalletAddress}) on ${wallet.network}`,
        );
    }

    public async signPayment(req: PaymentRequirement): Promise<PaymentSignature> {
        await this.resolveCustomerWallet();

        console.log('[Dfns Signer] Sign request:', req);

        if (BigInt(req.amount) > MAX_PAYMENT_AMOUNT) {
            throw new Error(`Payment ${req.amount} exceeds per-payment cap of ${MAX_PAYMENT_AMOUNT}`);
        }

        const message = {
            from: ethers.getAddress(this.customerWalletAddress),
            to: ethers.getAddress(req.recipient),
            value: req.amount,
            validAfter: req.validAfter,
            validBefore: req.validBefore,
            nonce: req.nonce,
        };

        console.log('[Dfns Signer] Requesting EIP-712 signature...');
        let sigResult: any = await this.dfnsApi.wallets.generateSignature({
            walletId: this.customerWalletId,
            body: {
                kind: 'Eip712',
                types: {
                    ReceiveWithAuthorization: [
                        { name: 'from', type: 'address' },
                        { name: 'to', type: 'address' },
                        { name: 'value', type: 'uint256' },
                        { name: 'validAfter', type: 'uint256' },
                        { name: 'validBefore', type: 'uint256' },
                        { name: 'nonce', type: 'bytes32' },
                    ],
                },
                domain: {
                    name: 'USDC',
                    version: '2',
                    chainId: req.chainId,
                    verifyingContract: ethers.getAddress(req.contract),
                },
                message,
            },
        });

        while (sigResult.status !== 'Signed') {
            if (sigResult.status === 'Failed' || sigResult.status === 'Rejected') {
                throw new Error(`Signature ${sigResult.status}: ${sigResult.reason}`);
            }
            console.log(`[Dfns Signer] Signature ${sigResult.status}, polling...`);
            await new Promise((resolve) => setTimeout(resolve, 2000));

            sigResult = await this.dfnsApi.wallets.getSignature({
                walletId: this.customerWalletId,
                signatureId: sigResult.id,
            });
        }

        const signedData = sigResult.signedData || sigResult.signature?.encoded;
        if (!signedData) throw new Error('Dfns returned no signed data');
        const signatureStr = signedData.startsWith('0x') ? signedData : `0x${signedData}`;

        console.log(`[Dfns Signer] Signed (id=${sigResult.id})`);

        return { protocol: 'EIP-3009', signature: signatureStr, message };
    }

    public async settlePayment(contractAddress: string, payment: PaymentSignature): Promise<string> {
        console.log('[Dfns Signer] Settling payment as facilitator...');

        // receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)
        const selector = '0xef55bec6';
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const sig = ethers.Signature.from(payment.signature);

        const params = abiCoder.encode(
            ['address', 'address', 'uint256', 'uint256', 'uint256', 'bytes32', 'uint8', 'bytes32', 'bytes32'],
            [
                payment.message.from,
                payment.message.to,
                payment.message.value,
                payment.message.validAfter,
                payment.message.validBefore,
                payment.message.nonce,
                sig.v,
                sig.r,
                sig.s,
            ],
        );
        const calldata = selector + params.slice(2);

        const result = await this.dfnsApi.wallets.broadcastTransaction({
            walletId: this.merchantWalletId,
            body: {
                kind: 'Eip1559',
                to: contractAddress,
                data: calldata,
                value: '0',
                gasLimit: '200000',
                maxFeePerGas: '5000000000',
                maxPriorityFeePerGas: '1000000000',
            } as any,
        });

        console.log('[Dfns Signer] Broadcast result:', JSON.stringify(result, null, 2));
        return result.txHash!;
    }
}
