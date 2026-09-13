'use client';

import { useState } from 'react';
import { connectWallet, sendApprove, waitForReceipt } from '@/lib/wallet';

// Must match PER_PULL_BASE_UNITS in the server's .env (default 100000 = 0.10 USDC).
const PER_PULL_USDC = 0.1;
const USDC_DECIMALS = 6n;
const ONE_USDC = 10n ** USDC_DECIMALS;

const MERCHANT_ADDRESS = process.env.NEXT_PUBLIC_MERCHANT_ADDRESS ?? '';
const USDC_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_USDC_CONTRACT_ADDRESS ?? '';

type OpenedSession = {
    sessionId: string;
    cap: string;
    expiresAt: number;
    approveTxHash: string;
};

type PullResponse = {
    reels: [string, string, string];
    win: boolean;
    multiplier: number;
    payoutLabel: string;
    txHash: string;
    session: { id: string; cap: string; spent: string; remaining: string };
};

const PLACEHOLDER_REELS: [string, string, string] = ['❓', '❓', '❓'];

type TxEntry = { hash: string; label: string };

function usdcToBaseUnits(amountUsdc: number): bigint {
    // Work in cents to avoid float rounding, matching the reference conversion.
    return (BigInt(Math.round(amountUsdc * 100)) * ONE_USDC) / 100n;
}

function baseUnitsToUsdc(units: string): number {
    const bi = BigInt(units);
    return Number(bi) / Number(ONE_USDC);
}

export default function SlotPage() {
    const [walletAddress, setWalletAddress] = useState<string | null>(null);
    const [isConnecting, setIsConnecting] = useState(false);

    const [session, setSession] = useState<OpenedSession | null>(null);
    const [authAmount, setAuthAmount] = useState<'1' | '2' | 'manual'>('1');
    const [manualAmount, setManualAmount] = useState('5');
    const [spentUsdc, setSpentUsdc] = useState(0);
    const [authStep, setAuthStep] = useState<'idle' | 'approving' | 'confirming' | 'registering'>('idle');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const [reels, setReels] = useState<[string, string, string]>(PLACEHOLDER_REELS);
    const [spinningReels, setSpinningReels] = useState<[boolean, boolean, boolean]>([false, false, false]);
    const [lastResult, setLastResult] = useState<PullResponse | null>(null);
    const [isPulling, setIsPulling] = useState(false);
    const [pulls, setPulls] = useState(0);
    const [wins, setWins] = useState(0);
    const [biggestMultiplier, setBiggestMultiplier] = useState(0);
    const [txEntries, setTxEntries] = useState<TxEntry[]>([]);

    const cap = authAmount === 'manual' ? parseFloat(manualAmount || '0') : parseFloat(authAmount);
    const displayedCap = session ? baseUnitsToUsdc(session.cap) : cap;
    const remaining = Math.max(0, displayedCap - spentUsdc);
    const canPull = session !== null && remaining >= PER_PULL_USDC && !isPulling;
    const isAuthorizing = authStep !== 'idle';

    async function handleConnect() {
        setErrorMsg(null);
        setIsConnecting(true);
        try {
            const address = await connectWallet();
            setWalletAddress(address);
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : String(err));
        } finally {
            setIsConnecting(false);
        }
    }

    async function handleAuthorize() {
        setErrorMsg(null);
        if (!walletAddress) {
            setErrorMsg('Connect a wallet first');
            return;
        }
        if (!isFinite(cap) || cap <= 0) {
            setErrorMsg('Budget must be a positive number');
            return;
        }
        if (!MERCHANT_ADDRESS || !USDC_CONTRACT_ADDRESS) {
            setErrorMsg('NEXT_PUBLIC_MERCHANT_ADDRESS / NEXT_PUBLIC_USDC_CONTRACT_ADDRESS not configured');
            return;
        }

        const budgetBaseUnits = usdcToBaseUnits(cap);

        try {
            // 1. Sign & submit the ONE approve, straight from the connected wallet.
            setAuthStep('approving');
            const approveTxHash = await sendApprove({
                from: walletAddress,
                usdcAddress: USDC_CONTRACT_ADDRESS,
                spender: MERCHANT_ADDRESS,
                amount: budgetBaseUnits,
            });

            // 2. Wait for it to be mined — the facilitator needs a confirmed receipt.
            setAuthStep('confirming');
            await waitForReceipt(approveTxHash);

            // 3. Register the session with the facilitator (verifies the tx on-chain again, server-side).
            setAuthStep('registering');
            const res = await fetch('/api/session/open', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    approvalTxHash: approveTxHash,
                    user: walletAddress,
                    budget: budgetBaseUnits.toString(),
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? `open session ${res.status}`);

            setSession(data);
            setSpentUsdc(0);
            setPulls(0);
            setWins(0);
            setBiggestMultiplier(0);
            setTxEntries([{ hash: approveTxHash, label: 'Approve (session open)' }]);
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : String(err));
        } finally {
            setAuthStep('idle');
        }
    }

    async function handlePull() {
        if (!canPull || !session) return;
        setErrorMsg(null);
        setIsPulling(true);
        setSpinningReels([true, true, true]);
        setLastResult(null);

        try {
            const res = await fetch('/api/pull', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: session.sessionId }),
            });
            const data = (await res.json()) as PullResponse & { error?: string };
            if (!res.ok) throw new Error(data.error ?? `pull ${res.status}`);

            setSpentUsdc(baseUnitsToUsdc(data.session.spent));
            setPulls((p) => p + 1);
            setTxEntries((prev) => [{ hash: data.txHash, label: `Settle (pull ${pulls + 1})` }, ...prev]);
            if (data.win) {
                setWins((w) => w + 1);
                if (data.multiplier > biggestMultiplier) setBiggestMultiplier(data.multiplier);
            }

            // Staggered reel reveal for a bit of drama.
            setTimeout(() => {
                setReels((prev) => [data.reels[0], prev[1], prev[2]]);
                setSpinningReels([false, true, true]);
            }, 500);
            setTimeout(() => {
                setReels((prev) => [data.reels[0], data.reels[1], prev[2]]);
                setSpinningReels([false, false, true]);
            }, 900);
            setTimeout(() => {
                setReels(data.reels);
                setSpinningReels([false, false, false]);
                setLastResult(data);
                setIsPulling(false);
            }, 1300);
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : String(err));
            setSpinningReels([false, false, false]);
            setReels(PLACEHOLDER_REELS);
            setIsPulling(false);
        }
    }

    async function handleClose() {
        if (!session) return;
        try {
            await fetch('/api/session/close', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: session.sessionId }),
            });
        } catch {
            // best-effort — closing just releases bookkeeping, nothing on-chain to undo
        }
        setSession(null);
        setReels(PLACEHOLDER_REELS);
        setLastResult(null);
    }

    const winRate = pulls > 0 ? ((wins / pulls) * 100).toFixed(0) : '0';

    const authorizeLabel =
        authStep === 'approving'
            ? 'Confirm in wallet…'
            : authStep === 'confirming'
              ? 'Waiting for confirmation…'
              : authStep === 'registering'
                ? 'Opening session…'
                : 'Authorize Session';

    return (
        <main className="slot-page">
            <div className="slot-title">
                <h1>Pull Once, Settle Many</h1>
                <p>
                    A slot machine powered by the x402 <span className="accent">session</span>{' '}
                    scheme. Connect a wallet, approve once, then every lever pull settles on-chain
                    with Circle USDC on Base Sepolia via ERC20 <span className="accent">transferFrom</span> —
                    broadcast from a Dfns-custodied merchant wallet, no further signature required.
                </p>
            </div>

            {/* Session panel */}
            <div className="panel">
                <div className="session-panel-top">
                    <div className="session-identity">
                        <div className="session-icon">🔐</div>
                        <div>
                            <h3>Bounded-Delegation Session</h3>
                            <p>
                                {walletAddress
                                    ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
                                    : 'Connect a wallet to authorize a budget'}
                            </p>
                            {session && <p className="session-id">Session {session.sessionId}</p>}
                        </div>
                    </div>

                    <div className="session-controls">
                        {!walletAddress ? (
                            <button className="btn btn-primary" onClick={handleConnect} disabled={isConnecting}>
                                {isConnecting ? 'Connecting…' : 'Connect Wallet'}
                            </button>
                        ) : (
                            <>
                                {!session && (
                                    <>
                                        <div className="segmented">
                                            {(['1', '2', 'manual'] as const).map((amount) => (
                                                <button
                                                    key={amount}
                                                    className={authAmount === amount ? 'active' : ''}
                                                    onClick={() => setAuthAmount(amount)}
                                                    disabled={isAuthorizing}
                                                >
                                                    {amount === 'manual' ? 'Manual' : `$${amount}`}
                                                </button>
                                            ))}
                                        </div>
                                        {authAmount === 'manual' && (
                                            <input
                                                type="number"
                                                className="manual-input"
                                                value={manualAmount}
                                                onChange={(e) => setManualAmount(e.target.value)}
                                                disabled={isAuthorizing}
                                                placeholder="5.00"
                                            />
                                        )}
                                    </>
                                )}

                                {!session ? (
                                    <button className="btn btn-primary" onClick={handleAuthorize} disabled={isAuthorizing}>
                                        {authorizeLabel}
                                    </button>
                                ) : (
                                    <button className="btn btn-outline" onClick={handleClose}>
                                        Close Session
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {session && (
                    <div className="stat-grid">
                        <div className="stat">
                            <span className="label">Authorized</span>
                            <span className="value">${displayedCap.toFixed(2)}</span>
                        </div>
                        <div className="stat">
                            <span className="label">Spent</span>
                            <span className="value primary">${spentUsdc.toFixed(2)}</span>
                        </div>
                        <div className="stat">
                            <span className="label">Remaining</span>
                            <span className="value">${remaining.toFixed(2)}</span>
                        </div>
                        <div className="stat">
                            <span className="label">Pulls left</span>
                            <span className="value">{Math.floor(remaining / PER_PULL_USDC)}</span>
                        </div>
                    </div>
                )}

                {errorMsg && <div className="error-banner">⚠ {errorMsg}</div>}
            </div>

            {/* Slot machine */}
            <div className="panel machine-panel">
                <div className="reels">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className={`reel${spinningReels[i] ? ' spinning' : ''}`}>
                            {spinningReels[i] ? '🎰' : reels[i]}
                        </div>
                    ))}
                </div>

                <button className="btn btn-primary pull-btn" onClick={handlePull} disabled={!canPull}>
                    {isPulling ? 'Spinning…' : `✨ Pull Lever · $${PER_PULL_USDC.toFixed(2)}`}
                </button>

                {lastResult && !isPulling && (
                    <div className={`payout-label${lastResult.win ? ' win' : ''}`}>{lastResult.payoutLabel}</div>
                )}

                {!walletAddress && <p className="hint">Connect a wallet to start.</p>}
                {walletAddress && !session && <p className="hint">Authorize a session above to start pulling.</p>}
                {session && remaining < PER_PULL_USDC && (
                    <p className="hint warn">Session balance exhausted — authorize a new session to keep playing.</p>
                )}
            </div>

            {/* Stats */}
            {pulls > 0 && (
                <div className="result-stats">
                    <div className="result-stat">
                        <div className="icon">🪙</div>
                        <div>
                            <div className="label">Pulls</div>
                            <div className="value">{pulls}</div>
                        </div>
                    </div>
                    <div className="result-stat">
                        <div className="icon">📈</div>
                        <div>
                            <div className="label">Wins</div>
                            <div className="value">
                                {wins} ({winRate}%)
                            </div>
                        </div>
                    </div>
                    <div className="result-stat">
                        <div className="icon">✨</div>
                        <div>
                            <div className="label">Best</div>
                            <div className="value">{biggestMultiplier > 0 ? `×${biggestMultiplier}` : '—'}</div>
                        </div>
                    </div>
                </div>
            )}

            {txEntries.length > 0 && (
                <div className="panel">
                    <h3 style={{ marginTop: 0, fontSize: '0.9rem' }}>Settlement transactions</h3>
                    <div className="tx-links">
                        {txEntries.map((entry, i) => (
                            <div key={entry.hash + i}>
                                <span className="tx-label">{entry.label}:</span>{' '}
                                <a
                                    href={`https://sepolia.basescan.org/tx/${entry.hash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {entry.hash} ↗
                                </a>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </main>
    );
}
