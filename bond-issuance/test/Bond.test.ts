import { expect } from "chai";
import { parseUnits, createPublicClient, createWalletClient, custom, http, type WalletClient, type PublicClient, getContractAddress } from "viem";
import { hardhat } from "viem/chains";
import hre from "hardhat";
import { describe, it, before } from "node:test";

describe("Bond", function () {
    let publicClient: PublicClient;
    let issuer: any; // WalletClient
    let investor1: any;
    let investor2: any;
    let accounts: string[];
    let provider: any;

    before(async function () {
        // Connect to network as per user suggestion for Hardhat v3
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
        issuer = createWalletClient({ chain: hardhat, transport: custom(provider), account: accounts[0] as `0x${string}` });
        investor1 = createWalletClient({ chain: hardhat, transport: custom(provider), account: accounts[1] as `0x${string}` });
        investor2 = createWalletClient({ chain: hardhat, transport: custom(provider), account: accounts[2] as `0x${string}` });
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
        // Deploy StableCoin
        const stableCoinInfo = await deployContract(issuer, "StableCoin", [accounts[0], "Euro Coin", "EURC"]);
        const stableCoin = await getContract(stableCoinInfo.address!, stableCoinInfo.abi, issuer);

        // Deploy Bond
        const notional = parseUnits("100", 6);
        const apr = 400n;
        const frequency = 90n * 24n * 3600n;
        const maturityDuration = 360n * 24n * 3600n;
        const now = await getLatestTime();
        const maturityDate = now + maturityDuration;

        const cap = parseUnits("1000000", 6);

        // Mint for Issuer First (so they can deposit principal)
        const initialBalance = parseUnits("100000", 6);
        await stableCoin.write.mint([accounts[0], initialBalance]);

        // Pre-compute future address
        const issuerAddress = accounts[0];
        const nonce = await publicClient.getTransactionCount({ address: issuerAddress as `0x${string}` });
        const bondAddress = await getContractAddress({ from: issuerAddress as `0x${string}`, nonce: BigInt(nonce) + 1n }); // +1 for approval tx

        // Approve Notional
        await stableCoin.write.approve([bondAddress, notional]);

        const bondInfo = await deployContract(issuer, "Bond", [
            "Corporate Bond 2027", "CB27", stableCoinInfo.address, notional, apr, frequency, maturityDate, cap
        ]);
        const bond = await getContract(bondInfo.address!, bondInfo.abi, issuer);

        // Mint & Approve
        await stableCoin.write.mint([accounts[1], initialBalance]);
        await stableCoin.write.mint([accounts[2], initialBalance]);

        const stableCoinInvest1 = await getContract(stableCoinInfo.address!, stableCoinInfo.abi, investor1);
        await stableCoinInvest1.write.approve([bondInfo.address!, initialBalance]);

        return { bond, bondAddress: bondInfo.address!, stableCoin, issuer, investor1, accounts, notional, frequency, maturityDate };
    }

    it("Should set the right owner", async function () {
        const fix1 = await deployBondFixture();
        const owner = await fix1.bond.read.owner([]);
        expect(owner.toLowerCase()).to.equal(fix1.accounts[0].toLowerCase());
    });

    it("Should allow subscription and update receipt", async function () {
        const fix1 = await deployBondFixture();
        const subAmount = parseUnits("1000", 6);
        const bondInvest1 = await getContract(fix1.bondAddress, (await hre.artifacts.readArtifact("Bond")).abi, fix1.investor1);
        await bondInvest1.write.subscribe([subAmount]);

        const receipt = await fix1.bond.read.subscriptionReceipts([fix1.accounts[1]]);
        expect(receipt).to.equal(subAmount);
    });

    it("Should allow claiming bonds after issuance close", async function () {
        const fix1 = await deployBondFixture();
        const subAmount = parseUnits("1000", 6);
        const bondInvest1 = await getContract(fix1.bondAddress, (await hre.artifacts.readArtifact("Bond")).abi, fix1.investor1);
        await bondInvest1.write.subscribe([subAmount]);

        await fix1.bond.write.closePrimaryIssuance();
        await bondInvest1.write.claimBond();
        const balance = await fix1.bond.read.balanceOf([fix1.accounts[1]]);
        expect(balance).to.equal(10000000n);
    });

    it("Should allow claiming coupons after due date", async function () {
        const fix1 = await deployBondFixture();
        const subAmount = parseUnits("1000", 6);
        const bondInvest1 = await getContract(fix1.bondAddress, (await hre.artifacts.readArtifact("Bond")).abi, fix1.investor1);
        await bondInvest1.write.subscribe([subAmount]);
        await fix1.bond.write.closePrimaryIssuance();
        await bondInvest1.write.claimBond();

        const couponAmount = await fix1.bond.read.getCouponAmount();
        await fix1.stableCoin.write.mint([fix1.accounts[0], couponAmount]);
        await fix1.stableCoin.write.approve([fix1.bondAddress, couponAmount]);
        await fix1.bond.write.depositCoupon([]);

        await increaseTime(fix1.frequency + 100n);
        const preBalance = await fix1.stableCoin.read.balanceOf([fix1.accounts[1]]);
        await bondInvest1.write.claimCoupon([1n]);
        const postBalance = await fix1.stableCoin.read.balanceOf([fix1.accounts[1]]);
        expect(postBalance - preBalance).to.equal(couponAmount);
    });

    it("Should redeem principal at maturity", async function () {
        const fix1 = await deployBondFixture();
        const subAmount = parseUnits("1000", 6);
        const bondInvest1 = await getContract(fix1.bondAddress, (await hre.artifacts.readArtifact("Bond")).abi, fix1.investor1);
        await bondInvest1.write.subscribe([subAmount]);
        await fix1.bond.write.closePrimaryIssuance();
        await bondInvest1.write.claimBond();

        const now = await getLatestTime();
        if (now < fix1.maturityDate) await increaseTime(fix1.maturityDate - now + 10n);

        // Principal needs to be deposited by Issuer
        // Issuer mints more stablecoin to cover principal
        const principalAmount = subAmount; // 1:1 ratio if notional=1? No, logic: (balance * notional) / 10**decimals.
        // Config: Notional 100. Decimals 0. Balance 10 (1000/100).
        // Payout = 10 * 100 = 1000.
        // So Issuer needs to deposit 1000.

        await fix1.stableCoin.write.mint([fix1.accounts[0], principalAmount]);
        await fix1.stableCoin.write.approve([fix1.bondAddress, principalAmount]);
        await fix1.bond.write.returnPrincipal([principalAmount]);

        const preRedeemBal = await fix1.stableCoin.read.balanceOf([fix1.accounts[1]]);
        await bondInvest1.write.redeem();
        const postRedeemBal = await fix1.stableCoin.read.balanceOf([fix1.accounts[1]]);
        expect(postRedeemBal - preRedeemBal).to.equal(subAmount);
    });

    it("Should trigger default if coupon not funded in grace period", async function () {
        const fix2 = await deployBondFixture();
        await fix2.bond.write.closePrimaryIssuance();
        const gracePeriod = 5n * 24n * 3600n;
        await increaseTime(fix2.frequency + gracePeriod + 100n);
        await fix2.bond.write.checkDefault([1n]);
        expect(await fix2.bond.read.isDefaulted()).to.be.true;
    });

});
