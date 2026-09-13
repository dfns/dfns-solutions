import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const FACILITATOR_URL = process.env.FACILITATOR_URL ?? 'http://localhost:4021';

export async function POST(req: NextRequest) {
    const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
    if (!body.sessionId) {
        return NextResponse.json({ error: 'missing sessionId' }, { status: 400 });
    }

    const res = await fetch(`${FACILITATOR_URL}/sessions/${body.sessionId}/close`, { method: 'POST' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
}
