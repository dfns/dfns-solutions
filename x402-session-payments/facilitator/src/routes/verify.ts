import type { Request, Response } from 'express';
import { getSession } from '../storage';
import { getNowSeconds } from '../evm';

export interface PaymentRequirements {
    scheme: string;
    network: string;
    asset: string;
    amount: string;
    payTo: string;
}

export interface VerifyRequest {
    sessionId: string;
    paymentRequirements: PaymentRequirements;
}

export interface VerifyResult {
    isValid: boolean;
    invalidReason?: string;
    invalidMessage?: string;
    payer?: string;
}

function addressMatches(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}

/**
 * Stateless check that a session can cover a payment: exists, not closed,
 * matching asset, recipient in the whitelist, not expired, within the
 * per-call cap, and within remaining budget headroom. Does not touch the chain
 * and does not debit the session — /settle re-runs this before it does either.
 */
export function verify(sessionId: string, requirements: PaymentRequirements): VerifyResult {
    const invalid = (reason: string, message?: string): VerifyResult => ({
        isValid: false,
        invalidReason: reason,
        invalidMessage: message ?? reason,
    });

    const session = getSession(sessionId);
    if (!session) return invalid('session_not_found', sessionId);
    if (session.closed) return invalid('session_closed');
    if (!addressMatches(session.asset, requirements.asset)) return invalid('asset_mismatch');
    if (!session.recipients.some((r) => addressMatches(r, requirements.payTo))) {
        return invalid('recipient_not_whitelisted', `${requirements.payTo} is not in the session's approved recipients`);
    }

    const now = getNowSeconds();
    if (session.expiresAt <= now) return invalid('session_expired');

    const amount = BigInt(requirements.amount);
    if (amount <= 0n) return invalid('invalid_amount');

    const maxPerCall = BigInt(session.maxPerCall);
    if (amount > maxPerCall) {
        return invalid('per_call_limit_exceeded', `amount ${amount} exceeds per-call cap ${maxPerCall}`);
    }

    const cap = BigInt(session.cap);
    const spent = BigInt(session.spent);
    if (spent + amount > cap) {
        return invalid('cap_exceeded', `cap=${cap} spent=${spent} requested=${amount}`);
    }

    return { isValid: true, payer: session.user };
}

export async function verifyHandler(req: Request, res: Response) {
    const body = req.body as Partial<VerifyRequest>;
    if (!body.sessionId || !body.paymentRequirements) {
        return res.status(400).json({ error: 'missing sessionId or paymentRequirements' });
    }
    const result = verify(body.sessionId, body.paymentRequirements);
    return res.json(result);
}
