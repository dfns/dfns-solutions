export interface PaymentRequirement {
    amount: string;
    asset: string;
    chainId: number;
    recipient: string;
    contract: string;
    nonce: string;
    validAfter: number;
    validBefore: number;
}

export interface PaymentSignature {
    protocol: 'EIP-3009';
    signature: string;
    message: {
        from: string;
        to: string;
        value: string;
        validAfter: number;
        validBefore: number;
        nonce: string;
    };
}
