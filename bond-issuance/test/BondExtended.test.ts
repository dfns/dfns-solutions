import { expect } from "chai";
import { parseUnits, createPublicClient, createWalletClient, custom, type PublicClient, getContractAddress } from "viem";
import { hardhat } from "viem/chains";
import hre from "hardhat";
import { describe, it, before } from "node:test";

describe("Bond Extended", function () {
    let publicClient: PublicClient;
    let issuer: any;
    let investor1: any;
    let investor2: any;
    let investor3: any;
    let accounts: string[];
    let provider: any;

    before(async function () {
        // @ts-ignore
        const conn = await hre.network.connect();
        provider = conn.provider;

        publicClient = createPublicClient({
            chain: hardhat,
            transport: custom(provider)
        });

        accounts = await provider.request({ method: "eth_accounts" }) as string[];
        issuer = createWalletClient({ chain: hardhat, transport: custom(provider), account: accounts[0] as `0x${string}` });
        investor1 = createWalletClient({ chain: hardhat, transport: custom(provider), account: accounts[1] as `0x${string}` });
        investor2 = createWalletClient({ chain: hardhat, transport: custom(provider), account: accounts[2] as `0x${string}` });
        investor3 = createWalletClient({ chain: hardhat, transport: custom(provider), account: accounts[3] as `0x${string}` });
    });

    // Helpers
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

    async function deployBondFixture() {
        const stableCoinInfo = await deployContract(issuer, "StableCoin", [accounts[0], "Euro Coin", "EURC"]);
        const stableCoin = await getContract(stableCoinInfo.address!, stableCoinInfo.abi, issuer);

        const notional = parseUnits("100", 6);
        const apr = 400n; // 4%
        const frequency = 90n * 24n * 3600n; // Quarterly
        const maturityDuration = 360n * 24n * 3600n; // 1 year approx
        const now = await getLatestTime();
        const maturityDate = now + maturityDuration;

        const cap = parseUnits("1000000", 6);

        // Mint for Issuer First (so they can deposit principal)
        const initialBalance = parseUnits("100000", 6);
        await stableCoin.write.mint([accounts[0], initialBalance]);

        // Pre-compute future address
        const issuerAddress = accounts[0];
        const nonce = await publicClient.getTransactionCount({ address: issuerAddress as `0x${string}` });
        const futureBondAddress = await getContractAddress({ from: issuerAddress as `0x${string}`, nonce: BigInt(nonce) + 1n }); // +1 for approval tx

        // Approve Notional
        await stableCoin.write.approve([futureBondAddress, notional]);

        const bondInfo = await deployContract(issuer, "Bond", [
            "Corporate Bond 2027", "CB27", stableCoinInfo.address, notional, apr, frequency, maturityDate, cap
        ]);
        const bond = await getContract(bondInfo.address!, bondInfo.abi, issuer);

        // Fund investors
        await stableCoin.write.mint([accounts[1], initialBalance]);
        await stableCoin.write.mint([accounts[2], initialBalance]);

        // Investor3 (for oversubscription tests, if applicable)
        if (accounts[3]) {
            await stableCoin.write.mint([accounts[3], initialBalance]);
        }

        const bondAddress = bondInfo.address!;

        // Approve
        const stableCoinInvest1 = await getContract(stableCoinInfo.address!, stableCoinInfo.abi, investor1);
        await stableCoinInvest1.write.approve([bondAddress, initialBalance]);

        const stableCoinInvest2 = await getContract(stableCoinInfo.address!, stableCoinInfo.abi, investor2);
        await stableCoinInvest2.write.approve([bondAddress, initialBalance]);

        if (accounts[3]) {
            const stableCoinInvest3 = await getContract(stableCoinInfo.address!, stableCoinInfo.abi, investor3);
            await stableCoinInvest3.write.approve([bondAddress, initialBalance]);
        }

        return { bond, bondAddress, stableCoin, issuer, investor1, investor2, investor3, accounts, notional, apr, frequency, maturityDate };
    }

    // --- Subscription Tests ---

    it("Should allow multiple holders to subscribe (Simulating 'Over-subscription' capability)", async function () {
        const fix = await deployBondFixture();
        const subAmount = parseUnits("1000", 6);

        // Investor 1 subscribes
        const bondInvest1 = await getContract(fix.bondAddress, (await hre.artifacts.readArtifact("Bond")).abi, fix.investor1);
        await bondInvest1.write.subscribe([subAmount]);
        expect(await fix.bond.read.subscriptionReceipts([fix.accounts[1]])).to.equal(subAmount);

        // Investor 2 subscribes (Over-subscription simply means more people coming in before close)
        const bondInvest2 = await getContract(fix.bondAddress, (await hre.artifacts.readArtifact("Bond")).abi, fix.investor2);
        await bondInvest2.write.subscribe([subAmount]);
        expect(await fix.bond.read.subscriptionReceipts([fix.accounts[2]])).to.equal(subAmount);

        // Check total raised (can infer from stablecoin balance of Bond or tracking events, checking receipts here)
        // Bond contract holds the funds (Subscriptions + Principal)
        const bondBalance = await fix.stableCoin.read.balanceOf([fix.bondAddress]);
        expect(bondBalance).to.equal(subAmount * 2n);
    });

    it("Should handle under-subscription (Issuance closed with less than expected)", async function () {
        const fix = await deployBondFixture();
        const subAmount = parseUnits("100", 6); // Small amount

        const bondInvest1 = await getContract(fix.bondAddress, (await hre.artifacts.readArtifact("Bond")).abi, fix.investor1);
        await bondInvest1.write.subscribe([subAmount]);

        // Issuer decides to close anyway
        await fix.bond.write.closePrimaryIssuance();

        // User claims
        await bondInvest1.write.claimBond();
        const balance = await fix.bond.read.balanceOf([fix.accounts[1]]);
        expect(balance).to.equal(1000000n); // 100 / 100 = 1 bond (1 * 10^6)
    });

    // --- Lifecycle Tests ---

    it("Should fail to redeem before maturity", async function () {
        const fix = await deployBondFixture();
        const subAmount = parseUnits("1000", 6);
        const bondInvest1 = await getContract(fix.bondAddress, (await hre.artifacts.readArtifact("Bond")).abi, fix.investor1);

        await bondInvest1.write.subscribe([subAmount]);
        await fix.bond.write.closePrimaryIssuance();
        await bondInvest1.write.claimBond();

        // Try redeem immediately
        try {
            await bondInvest1.write.redeem();
            expect.fail("Should have reverted");
        } catch (e: any) {
            expect(e.message).to.include("Not mature");
        }
    });

    it("Should respect grace period logic", async function () {
        const fix = await deployBondFixture();
        await fix.bond.write.closePrimaryIssuance();

        const couponDate = await fix.bond.read.getCouponDate([1n]);
        // Move to just after coupon date but WITHIN grace period
        const gracePeriod = await fix.bond.read.GRACE_PERIOD();
        // Time travel: couponDate + 1 second
        const now = await getLatestTime();
        await increaseTime(couponDate - now + 1n);

        // Check default - should NOT default yet
        await fix.bond.write.checkDefault([1n]);
        expect(await fix.bond.read.isDefaulted()).to.be.false;

        // Move PAST grace period
        await increaseTime(gracePeriod + 10n);

        // Now check default - should default because not funded
        await fix.bond.write.checkDefault([1n]);
        expect(await fix.bond.read.isDefaulted()).to.be.true;
    });

    it("Should allow processing coupon payments correctly", async function () {
        const fix = await deployBondFixture();
        const subAmount = parseUnits("1000", 6);
        const bondInvest1 = await getContract(fix.bondAddress, (await hre.artifacts.readArtifact("Bond")).abi, fix.investor1);

        await bondInvest1.write.subscribe([subAmount]);
        await fix.bond.write.closePrimaryIssuance();
        await bondInvest1.write.claimBond(); // Holds 10 bonds

        // Coupon 1
        let couponAmount = await fix.bond.read.getCouponAmount();

        await fix.stableCoin.write.mint([fix.accounts[0], couponAmount]);
        await fix.stableCoin.write.approve([fix.bondAddress, couponAmount]);
        await fix.bond.write.depositCoupon([]);

        await increaseTime(fix.frequency + 100n);

        // Coupon 2
        couponAmount = await fix.bond.read.getCouponAmount();
        await fix.stableCoin.write.mint([fix.accounts[0], couponAmount]);
        await fix.stableCoin.write.approve([fix.bondAddress, couponAmount]);
        await fix.bond.write.depositCoupon([]);

        // Move time forward
        const now = await getLatestTime();
        const couponDate = await fix.bond.read.getCouponDate([1n]);
        if (now < couponDate) {
            await increaseTime(couponDate - now + 10n);
        }

        // Claim
        const preBalance = await fix.stableCoin.read.balanceOf([fix.accounts[1]]);
        await bondInvest1.write.claimCoupon([1n]);
        const postBalance = await fix.stableCoin.read.balanceOf([fix.accounts[1]]);

        expect(postBalance - preBalance).to.equal(couponAmount);
        // Double claim should fail
        try {
            await bondInvest1.write.claimCoupon([1n]);
            expect.fail("Double claim");
        } catch (e: any) {
            expect(e.message).to.include("Already claimed");
        }
    });

    // --- Math & Accrued Interest Tests ---

    it("Should calculate accrued interest correctly", async function () {
        const fix = await deployBondFixture();
        const subAmount = parseUnits("1000", 6);
        const bondInvest1 = await getContract(fix.bondAddress, (await hre.artifacts.readArtifact("Bond")).abi, fix.investor1);

        await bondInvest1.write.subscribe([subAmount]);
        await fix.bond.write.closePrimaryIssuance();
        await bondInvest1.write.claimBond();

        // Accrued interest = (Balance * APR * Time) / (365 days * 10000)
        // Balance = 10 Bonds.
        // APR = 400 (4%)
        // Time = 1 year = 31536000s
        // Expected: (10 * 100 * 400 * 31536000) / (31536000 * 10000) = 400 / 100 = 4 EUR.
        // Note: Bond.sol decimals is 6. So balance is 10 * 10^6.
        // Formula in contract: (balance * notional) ... 

        const oneYear = 365n * 24n * 3600n;
        await increaseTime(oneYear);

        const interest = await fix.bond.read.accruedInterest([fix.accounts[1]]);
        // Calculation:
        // Principal = 10 * 100e6 = 1000e6 (1000 EUR)
        // Interest = (1000e6 * 400 * 31536000) / (31536000 * 10000)
        //          = (1000e6 * 400) / 10000 = 1000e6 * 0.04 = 40e6 (40 EUR)

        // Wait, notional is 100e6.
        // Contract: (balance * notional) / (10**6) = 10e6 * 100e6 / 1e6 = 1000e6.
        // Accrued = (1000e6 * 400 * oneYear) / (oneYear * 10000) = 40e6.

        // Let's verify.
        // 40 EUR = 40000000
        // allow small error due to block time variance (1-2 seconds)
        expect(Number(interest)).to.be.closeTo(Number(40000000n), Number(1000n));
    });

    it("Should handle leap year calculation correctly (via BondMath exposure or implicitly)", async function () {
        // Since BondMath is internal library, we might need a harness or just rely on the fact that BondMath uses 365 days fixed in constant
        // defined in BondMath.sol: uint256 public constant YEAR_IN_SECONDS = 365 days;
        // So actually, the contract assumes 365 days ALWAYS.
        // This test confirms that assumption (non-leap year logic is applied even in leap years).

        const fix = await deployBondFixture();

        // Check BondMath constants indirectly via accrued interest over 366 days
        const subAmount = parseUnits("1000", 6);
        const bondInvest1 = await getContract(fix.bondAddress, (await hre.artifacts.readArtifact("Bond")).abi, fix.investor1);
        await bondInvest1.write.subscribe([subAmount]);
        await fix.bond.write.closePrimaryIssuance();
        await bondInvest1.write.claimBond();

        const leapYearSeconds = 366n * 24n * 3600n;
        await increaseTime(leapYearSeconds);

        const interest = await fix.bond.read.accruedInterest([fix.accounts[1]]);
        // Expected: (1000e6 * 400 * 366 days) / (365 days * 10000)
        // = 40e6 * (366/365) approx 40.109e6

        const expected = (1000n * 1000000n * 400n * leapYearSeconds) / (31536000n * 10000n);
        expect(Number(interest)).to.be.closeTo(Number(expected), Number(2000n));
    });

    it("Should correctly calculate edge cases (0 time, 0 balance)", async function () {
        const fix = await deployBondFixture();
        const interest = await fix.bond.read.accruedInterest([fix.accounts[1]]);
        expect(interest).to.equal(0n); // No balance

        const subAmount = parseUnits("1000", 6);
        const bondInvest1 = await getContract(fix.bondAddress, (await hre.artifacts.readArtifact("Bond")).abi, fix.investor1);
        await bondInvest1.write.subscribe([subAmount]);
        await fix.bond.write.closePrimaryIssuance();
        await bondInvest1.write.claimBond();

        // 0 time elapsed
        const interestImm = await fix.bond.read.accruedInterest([fix.accounts[1]]);
        // Allow small deviation because block.timestamp might increment by 1 during the transaction
        expect(Number(interestImm)).to.be.closeTo(Number(0n), Number(1000n));
    });

});
