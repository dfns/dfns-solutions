import { dfnsApi, POLICY_USER_ID } from './DFNSCommon.js';

// npx tsx scripts/CreatePolicy.ts

async function main() {
  try {
    const policy = await dfnsApi.policies.createPolicy({
      body: {
        name: 'Smart Contract Policy',
        activityKind: 'Wallets:Sign',
        rule: {
          kind: 'AlwaysTrigger',
        },
        action: {
          kind: 'RequestApproval',
          approvalGroups: [
            {
              name: 'SmartContractApproverGroup',
              quorum: 1,
              approvers: {
                userId: {
                  in: [POLICY_USER_ID]
                }
              },
              initiatorCanApprove: true, // NOTE IN PROD THIS SHOULD BE FALSE - MAKER/CHECKER
              serviceAccountsCanApprove: true
            }
          ]
        },
        filters: {
          walletTags: {
            hasAny: ['autoreview']
          }
        }
      }
    });

    console.log(`Policy created: ${policy.name} (${policy.id})`);
  } catch (error: any) {
    if (error.context && error.context.body) {
      console.error("Failed to create policy:", JSON.stringify(error.context.body, null, 2));
    } else {
      console.error("Failed to create policy:", error);
    }
    process.exit(1);
  }
}

main();
