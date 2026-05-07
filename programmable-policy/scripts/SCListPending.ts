import { dfnsApi, SENDER_WALLET_ID } from './DFNSCommon.js';

async function main() {
  try {
    const approvals = await dfnsApi.policies.listApprovals({
      query: {
        status: 'Pending'
      }
    });

    console.log(`--- Pending Approvals ---`);

    if (approvals.items.length === 0) {
      console.log("No pending approvals found.");
      return;
    }

    for (const approval of approvals.items) {
      const activity = approval.activity as any;
      
      // Extract walletId from various potential activity structures
      const walletId = activity.walletId || 
                       activity.transferRequest?.walletId || 
                       activity.transactionRequest?.walletId || 
                       activity.signRequest?.walletId;

      if (!SENDER_WALLET_ID || walletId === SENDER_WALLET_ID) {
        console.log(`\x1b[36mID:\x1b[0m ${approval.id}`);
        console.log(`  \x1b[33mKind:\x1b[0m ${activity.kind}`);
        console.log(`  \x1b[33mCreated:\x1b[0m ${approval.dateCreated ? new Date(approval.dateCreated).toLocaleString() : 'Unknown'}`);
        if (walletId) console.log(`  \x1b[33mWallet ID:\x1b[0m ${walletId}`);
        console.log(`  \x1b[33mStatus:\x1b[0m ${approval.status}`);
        console.log('---');
      }
    }
  } catch (error) {
    console.error("Failed to list approvals:", error);
    process.exit(1);
  }
}

main();
