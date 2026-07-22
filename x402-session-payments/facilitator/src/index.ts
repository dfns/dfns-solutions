import express from 'express';
import { config } from './config';
import { supportedHandler } from './routes/supported';
import { createSessionHandler, getSessionHandler, closeSessionHandler } from './routes/sessions';
import { verifyHandler } from './routes/verify';
import { settleHandler } from './routes/settle';

const app = express();
app.use(express.json({ limit: '1mb' }));

// CORS — open for dev. Lock down in production.
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

app.get('/health', (_req, res) => res.json({ ok: true, network: config.network, chainId: config.chainId }));

// Standard x402 facilitator endpoints
app.get('/supported', supportedHandler);
app.post('/verify', verifyHandler);
app.post('/settle', settleHandler);

// Session-scheme extension endpoints
app.post('/sessions', createSessionHandler);
app.get('/sessions/:id', getSessionHandler);
app.post('/sessions/:id/close', closeSessionHandler);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[facilitator] unhandled error:', err);
    res.status(500).json({ error: err.message });
});

// Bind the port immediately — don't block startup on Dfns being reachable.
// The merchant wallet address is resolved lazily (and cached) on first use
// by whichever route needs it, so /health stays reachable even if Dfns is
// briefly unreachable or misconfigured.
app.listen(config.port, () => {
    let merchantLine: string;
    if (config.localMode && config.merchantPrivateKey) {
        merchantLine = `  merchant wallet: ${config.localMerchantAddress || '(derived from MERCHANT_PRIVATE_KEY)'} (LOCAL_MODE, private key — REAL broadcasts, no Dfns)\n`;
    } else if (config.localMode) {
        merchantLine = `  merchant wallet: ${config.localMerchantAddress} (LOCAL_MODE — no Dfns, no real broadcast)\n`;
    } else {
        merchantLine = `  merchant wallet: ${config.merchantWalletId} (resolved lazily via Dfns)\n`;
    }
    console.log(
        `[Dfns Session Facilitator] listening on :${config.port}\n` +
            `  network: ${config.network} (${config.networkCaip}, chainId=${config.chainId})\n` +
            `  rpc:     ${config.rpcUrl}\n` +
            `  usdc:    ${config.usdcAddress}\n` +
            merchantLine,
    );
});
