// Weighted reel strip — rarer symbols pay more, weighted less. Cosmetic only;
// no separate payout is transferred back to the player in this blueprint —
// the "win" is illustrative of what a real game would settle on top of the
// session payment already collected for the pull.

const REEL: { symbol: string; weight: number; multiplier: number }[] = [
    { symbol: '🍋', weight: 25, multiplier: 1 },
    { symbol: '🍒', weight: 20, multiplier: 2 },
    { symbol: '🍊', weight: 18, multiplier: 3 },
    { symbol: '🍇', weight: 15, multiplier: 5 },
    { symbol: '🔔', weight: 10, multiplier: 10 },
    { symbol: '⭐', weight: 7, multiplier: 25 },
    { symbol: '💎', weight: 4, multiplier: 100 },
    { symbol: '7️⃣', weight: 1, multiplier: 777 },
];

function spinOne(): { symbol: string; multiplier: number } {
    const total = REEL.reduce((s, r) => s + r.weight, 0);
    let roll = Math.random() * total;
    for (const r of REEL) {
        roll -= r.weight;
        if (roll <= 0) return { symbol: r.symbol, multiplier: r.multiplier };
    }
    return REEL[0];
}

export interface PullResult {
    reels: [string, string, string];
    win: boolean;
    multiplier: number;
    payoutLabel: string;
}

export function spinReels(): PullResult {
    const a = spinOne();
    const b = spinOne();
    const c = spinOne();
    const allSame = a.symbol === b.symbol && b.symbol === c.symbol;
    const twoSame = !allSame && (a.symbol === b.symbol || b.symbol === c.symbol || a.symbol === c.symbol);

    let multiplier = 0;
    let payoutLabel: string;
    if (allSame) {
        multiplier = a.multiplier;
        payoutLabel = `JACKPOT ${a.symbol}${a.symbol}${a.symbol} ×${multiplier}`;
    } else if (twoSame) {
        payoutLabel = 'So close! 2 of a kind (no payout)';
    } else {
        payoutLabel = 'No win — try again';
    }

    return { reels: [a.symbol, b.symbol, c.symbol], win: allSame, multiplier, payoutLabel };
}
