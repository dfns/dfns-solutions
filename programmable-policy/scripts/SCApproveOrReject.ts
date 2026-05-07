import { decodeFunctionData } from 'viem';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dfnsApi, SENDER_WALLET_ID, CONTRACT_ADDRESS, WHITELIST_ADDRESS } from './DFNSCommon.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_MINT_AMOUNT = 10_000_000n;

async function main() {
  if (!CONTRACT_ADDRESS || !WHITELIST_ADDRESS) {
    throw new Error("CONTRACT_ADDRESS and WHITELIST_ADDRESS must be set in .env.");
  }

  const approvals = await dfnsApi.policies.listApprovals({
    query: { status: 'Pending' }
  });

  const artifactPath = path.join(__dirname, '../artifacts/contracts/StableCoin.sol/StableCoin.json');
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Artifact not found at ${artifactPath}. Did you run 'npm run compile'?`);
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const { abi } = artifact;

  console.log(`--- Service-account checker — wallet ${SENDER_WALLET_ID} ---`);
  console.log(`Allowed contract:  ${CONTRACT_ADDRESS}`);
  console.log(`Mint whitelist:    ${WHITELIST_ADDRESS}`);
  console.log(`Mint amount cap:   ${MAX_MINT_AMOUNT}`);
  console.log('');

  for (const approval of approvals.items) {
    const activity = approval.activity as any;

    const walletId = activity.walletId ||
                     activity.transferRequest?.walletId ||
                     activity.transactionRequest?.walletId ||
                     activity.signRequest?.walletId;

    if (walletId !== SENDER_WALLET_ID) continue;

    console.log(`Approval ${approval.id}: ${activity.kind} (Status: ${approval.status})`);

    const requestBody = activity.requestBody ||
                        activity.transferRequest?.requestBody ||
                        activity.transactionRequest?.requestBody ||
                        activity.signRequest?.requestBody;

    if (!requestBody || !requestBody.data) {
      console.log("No call data on this request. Rejecting.");
      await reject(approval.id, 'No call data to evaluate');
      continue;
    }

    const toAddress = (requestBody.to || '').toLowerCase();
    if (toAddress !== CONTRACT_ADDRESS) {
      console.log(`Target ${toAddress} is not the configured contract. Rejecting.`);
      await reject(approval.id, 'Target address not allowed');
      continue;
    }

    let decoded: any;
    try {
      decoded = decodeFunctionData({
        abi,
        data: requestBody.data as `0x${string}`
      });
      console.log(`\x1b[32m>>> Decoded call: ${decoded.functionName}\x1b[0m`);
      console.log(`Arguments:`, JSON.stringify(decoded.args, (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v, 2));
    } catch (e) {
      console.log("Data could not be decoded with the StableCoin ABI. Rejecting.");
      await reject(approval.id, 'Call data does not match expected ABI');
      continue;
    }

    if (decoded.functionName !== 'mint') {
      console.log(`Function "${decoded.functionName}" is not allowed. Rejecting.`);
      await reject(approval.id, `Function ${decoded.functionName} not allowed`);
      continue;
    }

    const [destinationAddress, amount] = decoded.args as [string, bigint];
    console.log(`Destination: ${destinationAddress}`);
    console.log(`Amount:      ${amount}`);

    if (destinationAddress.toLowerCase() !== WHITELIST_ADDRESS) {
      console.log(`Destination not whitelisted. Rejecting.`);
      await reject(approval.id, 'Recipient not whitelisted');
    } else if (amount > MAX_MINT_AMOUNT) {
      console.log(`Amount exceeds ${MAX_MINT_AMOUNT}. Rejecting.`);
      await reject(approval.id, 'Amount exceeds policy cap');
    } else {
      console.log(`Whitelisted recipient and amount within limit. Approving.`);
      await approve(approval.id, 'Recipient whitelisted and amount within policy cap');
    }
  }
}

async function approve(approvalId: string, reason: string) {
  console.log(`Approving ${approvalId}...`);
  await dfnsApi.policies.createApprovalDecision({
    approvalId,
    body: { value: 'Approved', reason }
  });
  console.log("Approved.");
}

async function reject(approvalId: string, reason: string) {
  console.log(`Rejecting ${approvalId}...`);
  await dfnsApi.policies.createApprovalDecision({
    approvalId,
    body: { value: 'Denied', reason }
  });
  console.log("Rejected.");
}

main().catch((err) => {
  console.error("Service-account run failed:", err);
  process.exit(1);
});
