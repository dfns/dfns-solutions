import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const FACILITATOR_URL = process.env.FACILITATOR_URL ?? 'http://localhost:4021';

// The client has already signed & submitted the approve tx itself (e.g. via
// MetaMask) and waited for it to be mined — this route just forwards it to
// the facilitator for on-chain verification and session bookkeeping.
export async function POST(req: NextRequest) {
    const body = (await req.json().catch(() => ({}))) as {
        approvalTxHash?: string;
        user?: string;
        budget?: string;
    };
    if (!body.approvalTxHash || !body.user || !body.budget) {
        return NextResponse.json({ error: 'missing approvalTxHash, user, or budget' }, { status: 400 });
    }

    const merchantAddress = process.env.NEXT_PUBLIC_MERCHANT_ADDRESS;
    const perPull = process.env.PER_PULL_BASE_UNITS ?? '100000';
    if (!merchantAddress) {
        return NextResponse.json({ error: 'NEXT_PUBLIC_MERCHANT_ADDRESS is not configured' }, { status: 500 });
    }

    const res = await fetch(`${FACILITATOR_URL}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            approvalTxHash: body.approvalTxHash,
            user: body.user,
            budget: body.budget,
            recipients: [merchantAddress],
            ttlSeconds: 3600,
            maxPerCall: perPull,
        }),
    });

    const data = await res.json();
    if (!res.ok) {
        return NextResponse.json({ error: data.error ?? `facilitator /sessions ${res.status}` }, { status: res.status });
    }
    return NextResponse.json(data, { status: res.status });
}
