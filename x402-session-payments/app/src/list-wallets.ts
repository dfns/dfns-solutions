import { DfnsApiClient } from '@dfns/sdk';
import { AsymmetricKeySigner } from '@dfns/sdk-keysigner';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
    const signer = new AsymmetricKeySigner({
        credId: process.env.DFNS_CRED_ID!,
        privateKey: process.env.DFNS_PRIVATE_KEY!,
    });

    const dfnsApi = new DfnsApiClient({
        orgId: process.env.DFNS_ORG_ID!,
        authToken: process.env.DFNS_AUTH_TOKEN!,
        baseUrl: process.env.DFNS_API_URL!,
        signer,
    });

    const network = process.argv[2] || 'BaseSepolia';

    let all: any[] = [];
    let pageToken: string | undefined;
    do {
        const res: any = await dfnsApi.wallets.listWallets({ query: { paginationToken: pageToken } });
        all.push(...res.items);
        pageToken = res.nextPageToken;
    } while (pageToken);

    const filtered = all.filter((w) => w.network === network);
    console.log(
        JSON.stringify(
            filtered.map((w) => ({ id: w.id, address: w.address, network: w.network })),
            null,
            2,
        ),
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
