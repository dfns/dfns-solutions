import { dfnsApi } from './DFNSCommon.js';

// npx tsx scripts/ListPolicies.ts
async function main() {
  try {
    const policies = await dfnsApi.policies.listPolicies();

    for (const policy of policies.items) {
      console.log(`${policy.name}: ${policy.status}`);
    }
  } catch (error) {
    console.error("Failed to list policies:", error);
    process.exit(1);
  }
}

main();
