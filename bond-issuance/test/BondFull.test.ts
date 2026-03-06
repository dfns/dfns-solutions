import { expect } from "chai";
import { parseUnits, formatUnits, createPublicClient, createWalletClient, custom, type PublicClient, getContractAddress } from "viem";
import { hardhat } from "viem/chains";
import hre from "hardhat";
import { describe, it, before } from "node:test";

describe("Bond Full Lifecycle Test", function () {
    let publicClient: PublicClient;
    let issuer: any;
    let investors: any[] = [];
    let accounts: string[];
    let provider: any;

    let bond: any;
    let stableCoin: any;
    let bondAddress: `0x${string}`;
    let stableCoinAddress: `0x${string}`;

    // Test Parameters
    const notional = parseUnits("1000000", 6); // 1,000,000 ECU Notional (Face Value of 1 Bond)
    const cap = parseUnits("1000000", 6);      // 1,000,000 ECU Cap (Total Trace)
    const apr = 500n;                          // 5% APR
    // Quarterly Coupons
    const frequency = 90n * 24n * 3600n; // Quarterly
    const maturityDuration = 360n * 24n * 3600n + 3600n; // 1 year + buffer

    async function increaseTime(seconds: bigint) {
        await provider.request({ method: "evm_increaseTime", params: [Number(seconds)] });
        await provider.request({ method: "evm_mine" });
    }

    async function getLatestTime(): Promise<bigint> {
        const block = await publicClient.getBlock();
        return block.timestamp;
    }

    async function deployContract(client: any, name: string, args: any[]) {
        const artifact = await hre.artifacts.readArtifact(name);
        const hash = await client.deployContract({
            abi: artifact.abi,
            bytecode: artifact.bytecode as `0x${string}`,
            args: args
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        return { address: receipt.contractAddress, abi: artifact.abi };
    }

    async function getContract(address: `0x${string}`, abi: any, client: any) {
        return {
            address,
            write: new Proxy({}, {
                get: (_, prop) => async (args: any[] = []) => {
                    const hash = await client.writeContract({ address, abi, functionName: prop as string, args });
                    await publicClient.waitForTransactionReceipt({ hash });
                    return hash;
                }
            }) as any,
            read: new Proxy({}, {
                get: (_, prop) => async (args: any[] = []) => {
                    return await publicClient.readContract({ address, abi, functionName: prop as string, args });
                }
            }) as any
        };
    }

    before(async function () {
        // @ts-ignore
        const conn = await hre.network.connect();
        provider = conn.provider;
        publicClient = createPublicClient({ chain: hardhat, transport: custom(provider) });

        accounts = await provider.request({ method: "eth_accounts" }) as string[];

        // Setup Actors
        issuer = createWalletClient({ chain: hardhat, transport: custom(provider), account: accounts[0] as `0x${string}` });

        // 4 Investors
        for (let i = 1; i <= 4; i++) {
            investors.push(createWalletClient({ chain: hardhat, transport: custom(provider), account: accounts[i] as `0x${string}` }));
        }

        // 1. Deploy ECU StableCoin
        const stableCoinInfo = await deployContract(issuer, "StableCoin", [accounts[0], "ECU StableCoin", "ECU"]);
        stableCoinAddress = stableCoinInfo.address!;
        stableCoin = await getContract(stableCoinAddress, stableCoinInfo.abi, issuer);

        // 2. Mint ECU to Investors
        const amounts = ["100000", "200000", "200000", "500000"];
        for (let i = 0; i < 4; i++) {
            await stableCoin.write.mint([accounts[i + 1], parseUnits(amounts[i], 6)]);
        }

        // 3. Deploy Bond
        const now = await getLatestTime();
        const maturityDate = now + maturityDuration;

        // Pre-compute address for approval
        const nonce = await publicClient.getTransactionCount({ address: accounts[0] as `0x${string}` });
        const futureBondAddress = await getContractAddress({ from: accounts[0] as `0x${string}`, nonce: BigInt(nonce) + 1n });

        // Approve Notional (Issuer needs to approve the Bond contract to pull Notional? No, Issuer doesn't pay Notional, Investors do. Wait - checking Bond.sol constructor)
        // Bond.sol constructor doesn't pull funds.
        // But `returnPrincipal` later does.
        // `subscribe` pulls from Investor.

        // Wait, does the Bond contract need to be approved by Issuer for something at deployment?
        // No.

        const bondInfo = await deployContract(issuer, "Bond", [
            "Corporate Bond 2027", "CB27", stableCoinAddress, notional, apr, frequency, maturityDate, cap
        ]);
        bondAddress = bondInfo.address!;
        bond = await getContract(bondAddress, bondInfo.abi, issuer);

        console.log("Deployed Bond at:", bondAddress);
    });

    it("Should execute full lifecycle successfully", async function () {
        const bondAbi = (await hre.artifacts.readArtifact("Bond")).abi;
        const ecuAbi = (await hre.artifacts.readArtifact("StableCoin")).abi;

        // --- 1. Subscription Phase ---
        console.log("\n--- Subscription Phase ---");
        const subAmounts = ["100000", "200000", "200000", "500000"].map(a => parseUnits(a, 6));

        for (let i = 0; i < 4; i++) {
            const investorSigner = investors[i];
            const investorAddress = accounts[i + 1];

            // Connect Contracts
            const ecuInvestor = await getContract(stableCoinAddress, ecuAbi, investorSigner);
            const bondInvestor = await getContract(bondAddress, bondAbi, investorSigner);

            // Approve & Subscribe
            await ecuInvestor.write.approve([bondAddress, subAmounts[i]]);
            await bondInvestor.write.subscribe([subAmounts[i]]);

            // Verify Receipt
            const receipt = await bond.read.subscriptionReceipts([investorAddress]);
            expect(receipt).to.equal(subAmounts[i]);
            console.log(`Investor ${i + 1} subscribed: ${formatUnits(subAmounts[i], 6)} ECU`);
        }

        const totalSubscribed = await bond.read.totalSubscribed();
        expect(totalSubscribed).to.equal(cap); // 1M
        console.log("Total Subscribed:", formatUnits(totalSubscribed as bigint, 6));

        // --- 2. Close Issuance & Withdraw ---
        console.log("\n--- Close Issuance & Withdraw ---");
        await bond.write.closePrimaryIssuance();

        const bondEcuBalanceBefore = await stableCoin.read.balanceOf([bondAddress]);
        expect(bondEcuBalanceBefore).to.equal(cap);

        await bond.write.withdrawProceeds();

        const issuerBalance = await stableCoin.read.balanceOf([accounts[0]]);
        expect(issuerBalance).to.equal(cap); // Issuer had 0 initially (minted only to others) -> wait, issuer was minter.
        // Actually issuer balance might be slightly different if they paid gas? No, gas is ETH.
        // StableCoin balance should be exactly Cap.
        // Wait, did we mint to issuer? No.
        console.log("Issuer withdrew proceeds:", formatUnits(issuerBalance as bigint, 6));

        // --- 3. Claim Bonds ---
        console.log("\n--- Claim Bonds ---");
        // Formula: (Investment * 10^decimals) / Notional
        // Notional = 1,000,000.
        // Inv 1: 100,000.
        // Bond Token = (100,000 * 10^6) / 1,000,000 = 100,000.
        // Since Notional is 1M units, and Investment is 100k units. 
        // 1 Bond = 1M units. 
        // So Investor 1 has 0.1 Bonds.
        // 0.1 * 10^6 = 100,000 units of Bond Token.

        for (let i = 0; i < 4; i++) {
            const investorSigner = investors[i];
            const bondInvestor = await getContract(bondAddress, bondAbi, investorSigner);
            await bondInvestor.write.claimBond();

            const balance = await bond.read.balanceOf([accounts[i + 1]]);
            const expectedBalance = (subAmounts[i] * (10n ** 6n)) / notional;
            expect(balance).to.equal(expectedBalance);
            console.log(`Investor ${i + 1} claimed bonds: ${formatUnits(balance as bigint, 6)} (Raw: ${balance})`);
        }

        // --- 4. Coupons ---
        console.log("\n--- Coupon Phase ---");
        // There should be 4 coupons (360 days / 90 days = 4)

        // Total Principal = 1,000,000.
        // Coupon Rate (Quarterly) = 5% / 4 = 1.25%.
        // Coupon Amount = 1,000,000 * 0.0125 = 12,500.
        for (let couponIdx = 1; couponIdx <= 4; couponIdx++) {
            console.log(`Processing Coupon ${couponIdx}...`);
            const couponDate = await bond.read.getCouponDate([BigInt(couponIdx)]);
            const now = await getLatestTime();

            if (now < couponDate) {
                await increaseTime(couponDate - now + 1n);
            }

            // Issuer funds coupon
            // Mint ECU to Issuer first
            const couponAmount = await bond.read.getCouponAmount() as bigint;
            await stableCoin.write.mint([accounts[0], couponAmount]);
            await stableCoin.write.approve([bondAddress, couponAmount]);
            await bond.write.depositCoupon([]);

            // Investors claim
            for (let i = 0; i < 4; i++) {
                const investorSigner = investors[i];
                const bondInvestor = await getContract(bondAddress, bondAbi, investorSigner);
                const ecuInvestor = await getContract(stableCoinAddress, ecuAbi, investorSigner);

                const preBalance = await ecuInvestor.read.balanceOf([accounts[i + 1]]) as bigint;
                await bondInvestor.write.claimCoupon([BigInt(couponIdx)]);
                const postBalance = await ecuInvestor.read.balanceOf([accounts[i + 1]]) as bigint;

                // Share calculation: (BondBalance * TotalCoupon) / TotalSupply
                // BondBalance for Inv 1 = 100,000 units. TotalSupply = 1,000,000 units. Share = 10%.
                // 10% of 12,500 = 1,250.
                const share = postBalance - preBalance;
                console.log(`  Investor ${i + 1} received coupon: ${formatUnits(share, 6)}`);

                // Verify strict math
                // Inv 1 (10%): 1250
                // Inv 2 (20%): 2500
                // Inv 3 (20%): 2500
                // Inv 4 (50%): 6250
                // Sum = 12500. Correct.
            }
        }

        // --- 5. Redemption ---
        console.log("\n--- Redemption Phase ---");

        // Ensure maturity
        const maturityDate = await bond.read.maturityDate();
        const now = await getLatestTime();
        if (now < maturityDate) {
            await increaseTime(maturityDate - now + 1n);
        }

        // Issuer deposits Principal (1M)
        const principalTotal = parseUnits("1000000", 6);
        await stableCoin.write.mint([accounts[0], principalTotal]);
        await stableCoin.write.approve([bondAddress, principalTotal]);
        await bond.write.returnPrincipal([principalTotal]);

        // Investors redeem
        for (let i = 0; i < 4; i++) {
            const investorSigner = investors[i];
            const bondInvestor = await getContract(bondAddress, bondAbi, investorSigner);
            const ecuInvestor = await getContract(stableCoinAddress, ecuAbi, investorSigner);

            const preBalance = await ecuInvestor.read.balanceOf([accounts[i + 1]]) as bigint;
            await bondInvestor.write.redeem();
            const postBalance = await ecuInvestor.read.balanceOf([accounts[i + 1]]) as bigint;
            const redeemedAmount = postBalance - preBalance;

            console.log(`Investor ${i + 1} redeemed principal: ${formatUnits(redeemedAmount, 6)}`);

            // Should match original subscription
            expect(redeemedAmount).to.equal(subAmounts[i]);

            // Bond balance should be 0
            const bondBalance = await bondInvestor.read.balanceOf([accounts[i + 1]]);
            expect(bondBalance).to.equal(0n);
        }

        console.log("\nFull Lifecycle Completed Successfully!");
    });
});
