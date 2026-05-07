import { dfnsApi } from './DFNSCommon.js';

// npx tsx scripts/CheckUsers.ts 
async function main() {
  try {
    const users = await dfnsApi.auth.listUsers();
    console.log("Users:", JSON.stringify(users.items.map((u: any) => ({ userId: u.userId, username: u.username })), null, 2));

    // @ts-ignore
    const sas = await dfnsApi.auth.listServiceAccounts();
    console.log("Service Accounts:", JSON.stringify(sas.items, null, 2));
  } catch (error: any) {
    if (error.context && error.context.body) {
      console.error("Failed to list users:", JSON.stringify(error.context.body, null, 2));
    } else {
      console.error("Failed to list users:", error);
    }
  }
}

main();
