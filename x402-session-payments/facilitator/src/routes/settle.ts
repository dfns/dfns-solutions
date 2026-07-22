import type { Request, Response } from 'express';
import { debitSession, getSession, refundSession } from '../storage';
import { encodeTransferFrom, getNowSeconds } from '../evm';
import { broadcastFromMerchant } from '../dfns-client';
import { verify, VerifyRequest } from './verify';

/**
 * POST /settle
 *
 * Re-verifies (per the x402 spec, /settle must not trust a prior /verify call),
 * then debits the in-memory session and broadcasts the ERC20 `transferFrom`
 * from the merchant/facilitator Dfns wallet. If the on-chain call fails after
 * the debit, the debit is rolled back so the session isn't wrongly drained.
 *
 * No signature is requested from the customer here — the one-time approve
 * from POST /sessions is what authorizes this pull.
 */
export async function settleHandler(req: Request, res: Response) {
    const body = req.body as Partial<VerifyRequest>;
    if (!body.sessionId || !body.paymentRequirements) {
        return res.status(400).json({ error: 'missing sessionId or paymentRequirements' });
    }

    const verifyResult = verify(body.sessionId, body.paymentRequirements);
    if (!verifyResult.isValid) {
        return res.status(400).json({
            success: false,
            errorReason: verifyResult.invalidReason,
            errorMessage: verifyResult.invalidMessage,
        });
    }

    const session = getSession(body.sessionId)!;
    const amount = BigInt(body.paymentRequirements.amount);

    let debited;
    try {
        debited = debitSession(body.sessionId, amount, getNowSeconds());
    } catch (err) {
        return res.status(400).json({
            success: false,
            errorReason: 'debit_failed',
            errorMessage: err instanceof Error ? err.message : String(err),
        });
    }

    console.log(
        `[Facilitator] Envelope OK. Broadcasting transferFrom(${session.user}, ${body.paymentRequirements.payTo}, ${amount}) from merchant wallet (Dfns)...`,
    );

    try {
        const calldata = encodeTransferFrom(session.user, body.paymentRequirements.payTo, amount);
        const txHash = await broadcastFromMerchant(session.asset, calldata);

        return res.json({
            success: true,
            payer: session.user,
            transaction: txHash,
            network: session.network,
            session: {
                id: debited.id,
                cap: debited.cap,
                spent: debited.spent,
                remaining: (BigInt(debited.cap) - BigInt(debited.spent)).toString(),
            },
        });
    } catch (err) {
        console.error(`[Facilitator] on-chain transferFrom FAILED; rolling back debit for session=${body.sessionId}`, err);
        try {
            refundSession(body.sessionId, amount);
        } catch (refundErr) {
            console.error(`[Facilitator] CRITICAL: refund failed after on-chain failure`, refundErr);
        }
        return res.status(400).json({
            success: false,
            errorReason: 'onchain_transfer_failed',
            errorMessage: err instanceof Error ? err.message : String(err),
        });
    }
}
