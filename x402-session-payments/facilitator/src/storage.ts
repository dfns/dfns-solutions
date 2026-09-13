// In-memory session store. A blueprint-level stand-in for the persistent store
// (Postgres, Redis, sqlite) a production facilitator would use — swap this module
// out without touching the routes, which only depend on the functions below.

import { randomUUID } from 'node:crypto';

export interface SessionRecord {
    id: string;
    user: string;
    spender: string;
    asset: string;
    recipients: string[];
    cap: string;
    spent: string;
    maxPerCall: string;
    expiresAt: number;
    approveTxHash: string;
    network: string;
    createdAt: number;
    closed: boolean;
}

const sessions = new Map<string, SessionRecord>();

export function createSession(input: Omit<SessionRecord, 'id' | 'spent' | 'createdAt' | 'closed'>): SessionRecord {
    const record: SessionRecord = {
        id: randomUUID(),
        spent: '0',
        createdAt: Math.floor(Date.now() / 1000),
        closed: false,
        ...input,
    };
    sessions.set(record.id, record);
    return record;
}

export function getSession(id: string): SessionRecord | null {
    return sessions.get(id) ?? null;
}

/** Atomically debits `amount`, enforcing expiry + cap. Throws if either is violated. */
export function debitSession(id: string, amount: bigint, nowSeconds: number): SessionRecord {
    const record = sessions.get(id);
    if (!record) throw new Error(`session not found: ${id}`);
    if (record.closed) throw new Error(`session closed: ${id}`);
    if (record.expiresAt <= nowSeconds) {
        throw new Error(`session expired: expiresAt=${record.expiresAt} now=${nowSeconds}`);
    }

    const cap = BigInt(record.cap);
    const spent = BigInt(record.spent);
    const next = spent + amount;
    if (next > cap) {
        throw new Error(`session cap exceeded: cap=${cap} spent=${spent} requested=${amount}`);
    }

    record.spent = next.toString();
    return record;
}

/** Refund `amount` back to the session. Used when the on-chain transferFrom fails after debit. */
export function refundSession(id: string, amount: bigint): SessionRecord {
    const record = sessions.get(id);
    if (!record) throw new Error(`session not found: ${id}`);
    const spent = BigInt(record.spent);
    record.spent = (spent >= amount ? spent - amount : 0n).toString();
    return record;
}

export function closeSession(id: string): SessionRecord {
    const record = sessions.get(id);
    if (!record) throw new Error(`session not found: ${id}`);
    record.closed = true;
    return record;
}
