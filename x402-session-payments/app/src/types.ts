export interface SessionConfig {
    /** Total session budget in USDC base units (6 decimals). */
    budget: string;
    /** Payee addresses the session is allowed to pay. */
    recipients: string[];
    /** Session lifetime in seconds, counted from openSession(). */
    ttlSeconds: number;
    /** Per-payment cap in USDC base units — a floor beneath the total budget. */
    maxPerPayment: string;
}

export interface OpenedSession {
    sessionId: string;
    customer: string;
    /** The merchant/facilitator wallet address — the ERC20 `spender` in the approve. */
    spender: string;
    budget: string;
    recipients: string[];
    maxPerPayment: string;
    expiresAt: number;
    /** Tx hash of the one-time approve(spender, budget) call. */
    approveTxHash: string;
}

export interface PaymentRecord {
    itemId: string;
    amount: string;
    recipient: string;
    txHash: string;
    timestamp: number;
}

export interface SessionReceipt {
    sessionId: string;
    budget: string;
    totalSpent: string;
    remainingBudget: string;
    payments: PaymentRecord[];
    openedAt: number;
    closedAt: number;
    approveTxHash: string;
}
