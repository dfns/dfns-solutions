import { dfnsApi } from './DFNSCommon.js';

async function main() {
  const approvalId = process.argv[2];
  if (!approvalId) {
    console.error("Usage: npx tsx scripts/SCApprove.ts <approvalId>");
    process.exit(1);
  }

  console.log(`Approving decision: ${approvalId}...`);
  try {
    await dfnsApi.policies.createApprovalDecision({
      approvalId,
      body: {
        value: 'Approved',
        reason: 'Verified transaction details manually'
      }
    });
    console.log("Decision approved successfully.");
  } catch (error) {
    console.error("Failed to approve decision:", error);
    process.exit(1);
  }
}

main();
