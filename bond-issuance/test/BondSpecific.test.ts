import { expect } from "chai";
import { parseUnits, createPublicClient, createWalletClient, custom, type PublicClient, type WalletClient, getContractAddress } from "viem";
import { hardhat } from "viem/chains";
import hre from "hardhat";
import { describe, it, before } from "node:test";

describe("Bond Specific Test: Short Term", function () {
    let publicClient: PublicClient;
    let owner: any;
    let user: any;
    let accounts: string[];
    let provider: any;

    let bond: any;
    let currency: any;
    let bondAddress: any;

    // Test Parameters
    const notional = parseUnits("100", 6); // 100 EURC
    const apr = 400n; // 4% (Basis points)
    const frequency = 604800n; // 1 week
    const maturityDuration = 604800n + 3600n; // 1 week + 1 hour buffer

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

    // Setup
    before(async function () {
        // @ts-ignore
        const conn = await hre.network.connect();

        provider = conn.provider;
        if (!provider) {
            throw new Error("Provider is undefined");
        }

        publicClient = createPublicClient({
            chain: hardhat,
            transport: custom(provider)
        });

        accounts = await provider.request({ method: "eth_accounts" }) as string[];
        owner = createWalletClient({ chain: hardhat, transport: custom(provider), account: accounts[0] as `0x${string}` });
        user = createWalletClient({ chain: hardhat, transport: custom(provider), account: accounts[1] as `0x${string}` });

        // Deploy Fake Currency
        const stableCoinInfo = await deployContract(owner, "StableCoin", [accounts[0], "Euro Coin", "EURC"]);
        currency = await getContract(stableCoinInfo.address!, stableCoinInfo.abi, owner);

        // Mint some currency to user and owner
        await currency.write.mint([accounts[1], parseUnits("100000", 6)]);
        await currency.write.mint([accounts[0], parseUnits("100000", 6)]);

        // Get current time
        const now = await getLatestTime();
        const maturityDate = now + maturityDuration; // 1 week + buffer from now

        // Pre-compute future address
        const issuerAddress = accounts[0];
        const nonce = await publicClient.getTransactionCount({ address: issuerAddress as `0x${string}` });
        const futureBondAddress = await getContractAddress({ from: issuerAddress as `0x${string}`, nonce: BigInt(nonce) + 1n }); // +1 for approval tx

        // Approve Notional
        // The owner is accounts[0]
        await currency.write.approve([futureBondAddress, notional]);

        // Deploy Bond
        const bondInfo = await deployContract(owner, "Bond", [
            "Short Term Bond",
            "STB",
            stableCoinInfo.address,
            notional,
            apr,
            frequency,
            maturityDate,
            parseUnits("1000000", 6) // Cap
        ]);
        bondAddress = bondInfo.address;

        // We need bond instances for owner and user
        bond = await getContract(bondInfo.address!, bondInfo.abi, owner);
    });

    it("Should execute full lifecycle for 1 week bond", async function () {
        const bondUser = await getContract(bondAddress, (await hre.artifacts.readArtifact("Bond")).abi, user);

        // 1. Subscribe
        const investment = parseUnits("1000", 6); // 1000 EURC -> 10 Bonds

        // Approve
        const currencyUser = await getContract(currency.address, (await hre.artifacts.readArtifact("StableCoin")).abi, user);
        await currencyUser.write.approve([bondAddress, investment]);

        // Subscribe
        await bondUser.write.subscribe([investment]);

        // 2. Close Issuance
        await bond.write.closePrimaryIssuance();
        const issuanceDate = await getLatestTime();
        console.log("Issuance Date:", issuanceDate);

        // 3. Claim Bond
        await bondUser.write.claimBond();
        const userBalance = await bond.read.balanceOf([accounts[1]]);
        expect(userBalance).to.equal(10000000n);

        // CHECK VIEW FUNCTIONS
        const totalIssued = await bond.read.totalBondsIssued();
        expect(totalIssued).to.equal(10000000n);

        // 4. Check time to next coupon
        const timeToCoupon = await bond.read.timeToNextCoupon();
        console.log("Time to Next Coupon (approx):", timeToCoupon.toString());
        expect(Number(timeToCoupon)).to.be.closeTo(Number(frequency), 10);

        // 5. Fast Forward to Coupon Date (which should also cover maturity for this 1-period bond)
        const couponDate = await bond.read.getCouponDate([1n]);
        const now = await getLatestTime();
        if (now <= couponDate) {
            await increaseTime(couponDate - now + 1n);
        }

        // 6. Fund Coupon (Coupon Index 1)
        const couponAmount = await bond.read.getCouponAmount();

        await currency.write.approve([bondAddress, couponAmount]);
        await bond.write.depositCoupon([]);

        const couponFunded = await bond.read.couponFunded([1n]);
        expect(couponFunded).to.be.true;

        // 7. Claim Coupon
        const preCouponBalance = await currency.read.balanceOf([accounts[1]]);
        await bondUser.write.claimCoupon([1n]);

        const postCouponBalance = await currency.read.balanceOf([accounts[1]]);
        expect(postCouponBalance - preCouponBalance).to.equal(couponAmount);

        // 8. Redeem Principal
        // Principal already deposited in constructor

        // Redeem
        const maturityDateContract = await bond.read.maturityDate();
        const now2 = await getLatestTime();
        if (now2 < maturityDateContract) {
            await increaseTime(maturityDateContract - now2 + 1n);
        }

        await bondUser.write.redeem();

        const endBondBalance = await bond.read.balanceOf([accounts[1]]);
        expect(endBondBalance).to.equal(0n);

        // CHECK VIEW FUNCTIONS
        const totalRedeemed = await bond.read.totalBondsRedeemed();
        expect(totalRedeemed).to.equal(10000000n);
    });
});
