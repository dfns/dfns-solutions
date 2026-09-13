import type { Request, Response } from 'express';
import { ethers } from 'ethers';
import { config } from '../config';
import { resolveMerchantWallet } from '../dfns-client';
import { assertApprovalTx, getNowSeconds } from '../evm';
import { createSession, getSession, closeSession } from '../storage';

export interface CreateSessionBody {
    approvalTxHash: string;
    user: string; // the customer's own wallet address (e.g. MetaMask), not Dfns-custodied
    budget: string; // base units
    recipients: string[];
    ttlSeconds: number;
    maxPerCall: string; // base units
}

/**
 * POST /sessions
 *
 * Sign once: the caller has already signed & submitted an ERC20
 * `approve(spender=merchant, budget)` on-chain — from their own wallet
 * (MetaMask, or anything else), not a Dfns-custodied one. This endpoint
 * verifies that tx (target contract, spender, from, value, live allowance)
 * before opening the session. The merchant/spender side stays Dfns-custodied:
 * every subsequent transferFrom is broadcast from the Dfns merchant wallet.
 */
export async function createSessionHandler(req: Request, res: Response) {
    const body = req.body as Partial<CreateSessionBody>;
    const requiredFields: (keyof CreateSessionBody)[] = [
        'approvalTxHash',
        'user',
        'budget',
        'recipients',
        'ttlSeconds',
        'maxPerCall',
    ];
    for (const k of requiredFields) {
        if (body[k] === undefined || body[k] === null) {
            return res.status(400).json({ error: `missing field: ${k}` });
        }
    }
    const input = body as CreateSessionBody;
    if (!Array.isArray(input.recipients) || input.recipients.length === 0) {
        return res.status(400).json({ error: 'recipients must be a non-empty array' });
    }

    try {
        const { merchantAddress } = await resolveMerchantWallet();
        const budget = BigInt(input.budget);
        const recipients = input.recipients.map((r) => ethers.getAddress(r));
        const user = ethers.getAddress(input.user);

        console.log(`[Facilitator] Verifying approval tx ${input.approvalTxHash} for session: budget=${budget}, recipients=${recipients.join(',')}`);

        await assertApprovalTx({
            txHash: input.approvalTxHash,
            expectedAsset: config.usdcAddress,
            expectedSpender: merchantAddress,
            expectedFrom: user,
            minValue: budget,
        });

        const expiresAt = getNowSeconds() + input.ttlSeconds;

        const record = createSession({
            user,
            spender: merchantAddress,
            asset: config.usdcAddress,
            recipients,
            cap: budget.toString(),
            maxPerCall: input.maxPerCall,
            expiresAt,
            approveTxHash: input.approvalTxHash,
            network: config.network,
        });

        return res.status(201).json({
            sessionId: record.id,
            user: record.user,
            spender: record.spender,
            asset: record.asset,
            recipients: record.recipients,
            cap: record.cap,
            spent: record.spent,
            maxPerCall: record.maxPerCall,
            expiresAt: record.expiresAt,
            approveTxHash: record.approveTxHash,
            network: record.network,
        });
    } catch (err) {
        return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
}

/** GET /sessions/:id — inspect remaining cap / spent / expiry. */
export function getSessionHandler(req: Request, res: Response) {
    const id = req.params.id as string;
    const record = getSession(id);
    if (!record) return res.status(404).json({ error: 'session not found' });
    return res.json(record);
}

/** POST /sessions/:id/close — release remaining budget, return a receipt. */
export function closeSessionHandler(req: Request, res: Response) {
    const id = req.params.id as string;
    try {
        const record = closeSession(id);
        const cap = BigInt(record.cap);
        const spent = BigInt(record.spent);
        return res.json({
            sessionId: record.id,
            cap: record.cap,
            spent: record.spent,
            remaining: (cap - spent).toString(),
            closed: true,
        });
    } catch (err) {
        return res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
}
