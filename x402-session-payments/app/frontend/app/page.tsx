export default function HomePage() {
    return (
        <main>
            <section className="hero">
                <h1>
                    Sign once, <span className="accent">settle many times</span>.
                </h1>
                <p>
                    A bounded-delegation session on top of x402: one wallet-signed ERC20{' '}
                    <code>approve</code> opens a budget / recipient / TTL envelope, then every
                    payment after that settles via <code>transferFrom</code> — broadcast from a
                    Dfns-custodied merchant wallet, no further signature required.
                </p>
            </section>

            <h2 className="section-title center">Features</h2>
            <section className="features">
                <div className="feature-card">
                    <h3>Budget cap</h3>
                    <p>Enforced by the ERC20 allowance itself — a transferFrom past the approved amount simply reverts.</p>
                    <span className="trust-badge onchain">On-chain</span>
                </div>
                <div className="feature-card">
                    <h3>Recipient whitelist</h3>
                    <p>The session signer refuses to broadcast a settlement to any address outside the approved list.</p>
                    <span className="trust-badge offchain">Off-chain / Dfns Policy</span>
                </div>
                <div className="feature-card">
                    <h3>Expiry (TTL)</h3>
                    <p>Past the session's expiry, the signer refuses to broadcast — no matter how much budget remains.</p>
                    <span className="trust-badge offchain">Off-chain / Dfns Policy</span>
                </div>
                <div className="feature-card">
                    <h3>Per-payment cap</h3>
                    <p>A floor beneath the total budget — caps how much any single payment can move at once.</p>
                    <span className="trust-badge offchain">Off-chain / Dfns Policy</span>
                </div>
            </section>

            <section className="features" style={{ gridTemplateColumns: '1fr' }}>
                <div className="feature-card">
                    <h3>Not about removing signatures — about bounding them</h3>
                    <p>
                        A Dfns-backed service account can already sign autonomously. Sessions add
                        an enforcement envelope on top of that autonomy: a budget agreed once,
                        held to on every payment after. The keys never leave Dfns; only the
                        merchant wallet is authorized to pull funds, and only up to what was
                        approved.
                    </p>
                </div>
            </section>

            <footer className="site-footer">
                <span>Dfns X402 Session Payments — blueprint demo</span>
                <span>
                    Built on{' '}
                    <a href="https://www.x402.org/" target="_blank" rel="noopener noreferrer">
                        x402
                    </a>
                </span>
            </footer>
        </main>
    );
}
