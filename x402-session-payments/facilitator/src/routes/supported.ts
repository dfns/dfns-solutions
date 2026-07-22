import type { Request, Response } from 'express';
import { config } from '../config';
import { resolveMerchantWallet } from '../dfns-client';

export async function supportedHandler(_req: Request, res: Response) {
    try {
        const { merchantAddress } = await resolveMerchantWallet();

        const extra = {
            areFeesSponsored: true,
            facilitatorAddress: merchantAddress,
            spender: merchantAddress,
            sessionsEndpoint: '/sessions',
            chainId: config.chainId,
        };

        const networks = [config.network, config.networkCaip];
        const kinds = networks.map((network) => ({ x402Version: 2, scheme: 'session', network, extra }));

        res.json({
            kinds,
            extensions: [],
            signers: {
                'evm:*': [merchantAddress],
                'eip155:*': [merchantAddress],
            },
        });
    } catch (err) {
        res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
}
