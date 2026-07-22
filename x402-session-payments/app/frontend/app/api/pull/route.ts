// POST /api/pull — the x402-protected slot machine "resource". Each pull asks
// the standalone facilitator to /settle a session payment: the facilitator
// checks the session's budget / recipient / expiry / per-call cap, then
// broadcasts a transferFrom from its Dfns-custodied merchant wallet. This app
// never talks to Dfns directly and never asks the player to sign anything —
// the one approve from /api/session/open already authorized every pull.

import { NextRequest, NextResponse } from 'next/server';
import { spinReels } from '@/lib/reel';

export const runtime = 'nodejs';

const FACILITATOR_URL = process.env.FACILITATOR_URL ?? 'http://localhost:4021';
const NETWORK = process.env.NETWORK ?? 'base:sepolia';

export async function POST(req: NextRequest) {
    const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
    if (!body.sessionId) {
        return NextResponse.json({ error: 'missing sessionId' }, { status: 400 });
    }

    const merchantAddress = process.env.NEXT_PUBLIC_MERCHANT_ADDRESS;
    const usdcAddress = process.env.NEXT_PUBLIC_USDC_CONTRACT_ADDRESS;
    const perPull = process.env.PER_PULL_BASE_UNITS ?? '100000';
    if (!merchantAddress || !usdcAddress) {
        return NextResponse.json(
            { error: 'NEXT_PUBLIC_MERCHANT_ADDRESS / NEXT_PUBLIC_USDC_CONTRACT_ADDRESS not configured' },
            { status: 500 },
        );
    }

    // /settle re-verifies internally (per the x402 spec), so a separate
    // /verify call first isn't needed here.
    const settleRes = await fetch(`${FACILITATOR_URL}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sessionId: body.sessionId,
            paymentRequirements: {
                scheme: 'session',
                network: NETWORK,
                asset: usdcAddress,
                amount: perPull,
                payTo: merchantAddress,
            },
        }),
    });
    const settleData = await settleRes.json();

    if (!settleRes.ok || !settleData.success) {
        const reason = settleData.errorReason ?? 'settle_failed';
        const message = settleData.errorMessage ?? reason;
        return NextResponse.json({ error: `${reason}: ${message}` }, { status: 402 });
    }

    const result = spinReels();

    return NextResponse.json({
        ...result,
        txHash: settleData.transaction,
        priceBaseUnits: perPull,
        session: settleData.session, // { id, cap, spent, remaining }
    });
}
