import { dfnsApi } from './DFNSCommon.js';

async function main() {
  const approvalId = process.argv[2];
  if (!approvalId) {
    console.error("Usage: npx tsx scripts/SCReject.ts <approvalId>");
    process.exit(1);
  }

  console.log(`Rejecting decision: ${approvalId}...`);
  try {
    await dfnsApi.policies.createApprovalDecision({
      approvalId,
      body: {
        value: 'Denied',
        reason: 'Transaction rejected manually'
      }
    });
    console.log("Decision rejected successfully.");
  } catch (error) {
    console.error("Failed to reject decision:", error);
    process.exit(1);
  }
}

main();
