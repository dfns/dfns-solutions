import { describe, it, beforeEach } from "node:test";
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseUnits, keccak256, stringToBytes } from "viem";

describe("CrossBorderPayment", function () {
    let connection: any;
    let crossBorderPayment: any;
    let iEUR: any;
    let iAUD: any;
    let owner: any;
    let sender: any;
    let receiver: any;
    let fxProvider: any;
    let publicClient: any;

    beforeEach(async function () {
        connection = await hre.network.connect();
        const [ownerClient, senderClient, receiverClient, fxProviderClient] = await connection.viem.getWalletClients();
        owner = ownerClient;
        sender = senderClient;
        receiver = receiverClient;
        fxProvider = fxProviderClient;

        iEUR = await connection.viem.deployContract("StableCoin", [owner.account.address, "Interest EUR", "iEUR"]);
        iAUD = await connection.viem.deployContract("StableCoin", [owner.account.address, "Interest AUD", "iAUD"]);

        crossBorderPayment = await connection.viem.deployContract("CrossBorderPayment", [iEUR.address, iAUD.address]);

        // Give CrossBorderPayment ownership of iAUD and MINTER_ROLE so it can mint
        await iAUD.write.transferOwnership([crossBorderPayment.address]);
        const MINTER_ROLE = keccak256(stringToBytes("MINTER_ROLE"));
        await iAUD.write.grantRole([MINTER_ROLE, crossBorderPayment.address]);

        // Mint some iEUR to sender
        await iEUR.write.mint([sender.account.address, parseUnits("1000", 6)]);

        publicClient = await connection.viem.getPublicClient();
    });

    describe("Deployment", function () {
        it("Should set the right stablecoin addresses", async function () {
            expect(await crossBorderPayment.read.iEUR()).to.equal(getAddress(iEUR.address));
            expect(await crossBorderPayment.read.iAUD()).to.equal(getAddress(iAUD.address));
        });

        it("Should set the right owner", async function () {
            expect(await crossBorderPayment.read.owner()).to.equal(getAddress(owner.account.address));
        });
    });

    describe("Payment Flow", function () {
        it("Should init payment correctly", async function () {
            const amount = parseUnits("100", 6);

            // Approve CrossBorderPayment to spend sender's iEUR
            await iEUR.write.approve([crossBorderPayment.address, amount], { account: sender.account });

            await crossBorderPayment.write.initPayment([receiver.account.address, amount], { account: sender.account });

            const payment = await crossBorderPayment.read.payments([0n]);

            // payment struct: id, sender, receiver, iEURAmount, iAUDAmount, status
            expect(payment[0]).to.equal(0n); // id
            expect(payment[1]).to.equal(getAddress(sender.account.address)); // sender
            expect(payment[2]).to.equal(getAddress(receiver.account.address)); // receiver
            expect(payment[3]).to.equal(amount); // iEURAmount
            expect(payment[5]).to.equal(0); // status PENDING_FX (enum index 0)
        });

        it("Should emit PaymentInitiated event", async function () {
            const amount = parseUnits("100", 6);
            await iEUR.write.approve([crossBorderPayment.address, amount], { account: sender.account });

            const hash = await crossBorderPayment.write.initPayment([receiver.account.address, amount], { account: sender.account });
            await publicClient.waitForTransactionReceipt({ hash });

            const events = await crossBorderPayment.getEvents.PaymentInitiated();
            expect(events).to.have.lengthOf(1);
            expect(events[0].args.paymentId).to.equal(0n);
            expect(events[0].args.sender).to.equal(getAddress(sender.account.address));
            expect(events[0].args.receiver).to.equal(getAddress(receiver.account.address));
            expect(events[0].args.amount).to.equal(amount);
        });

        it("Should set FX rate correctly", async function () {
            const amount = parseUnits("100", 6);
            await iEUR.write.approve([crossBorderPayment.address, amount], { account: sender.account });
            await crossBorderPayment.write.initPayment([receiver.account.address, amount], { account: sender.account });

            const iAUDAmount = parseUnits("150", 6); // 1.5 rate
            await crossBorderPayment.write.setFXRate([0n, iAUDAmount], { account: owner.account });

            const payment = await crossBorderPayment.read.payments([0n]);
            expect(payment[4]).to.equal(iAUDAmount); // iAUDAmount
            expect(payment[5]).to.equal(1); // status FX_RATE_SET (enum index 1)
        });

        it("Should emit FXRateSet event", async function () {
            const amount = parseUnits("100", 6);
            await iEUR.write.approve([crossBorderPayment.address, amount], { account: sender.account });
            await crossBorderPayment.write.initPayment([receiver.account.address, amount], { account: sender.account });

            const iAUDAmount = parseUnits("150", 6);
            const hash = await crossBorderPayment.write.setFXRate([0n, iAUDAmount], { account: owner.account });
            await publicClient.waitForTransactionReceipt({ hash });

            const events = await crossBorderPayment.getEvents.FXRateSet();
            expect(events).to.have.lengthOf(1);
            expect(events[0].args.paymentId).to.equal(0n);
            expect(events[0].args.iAUDAmount).to.equal(iAUDAmount);
        });

        it("Should execute payment correctly", async function () {
            const amount = parseUnits("100", 6);

            await iEUR.write.approve([crossBorderPayment.address, amount], { account: sender.account });
            await crossBorderPayment.write.initPayment([receiver.account.address, amount], { account: sender.account });

            const iAUDAmount = parseUnits("150", 6);
            await crossBorderPayment.write.setFXRate([0n, iAUDAmount], { account: owner.account });

            // Execute
            await crossBorderPayment.write.executePayment([0n], { account: sender.account });

            const payment = await crossBorderPayment.read.payments([0n]);
            expect(payment[5]).to.equal(2); // status COMPLETED

            // Check balances
            const senderBalance = await iEUR.read.balanceOf([sender.account.address]);
            expect(senderBalance).to.equal(parseUnits("900", 6)); // 1000 - 100

            const receiverBalance = await iAUD.read.balanceOf([receiver.account.address]);
            expect(receiverBalance).to.equal(iAUDAmount);
        });

        it("Should emit PaymentCompleted event", async function () {
            const amount = parseUnits("100", 6);

            await iEUR.write.approve([crossBorderPayment.address, amount], { account: sender.account });
            await crossBorderPayment.write.initPayment([receiver.account.address, amount], { account: sender.account });

            const iAUDAmount = parseUnits("150", 6);
            await crossBorderPayment.write.setFXRate([0n, iAUDAmount], { account: owner.account });

            const hash = await crossBorderPayment.write.executePayment([0n], { account: sender.account });
            await publicClient.waitForTransactionReceipt({ hash });

            const events = await crossBorderPayment.getEvents.PaymentCompleted();
            expect(events).to.have.lengthOf(1);
            expect(events[0].args.paymentId).to.equal(0n);
            expect(events[0].args.sender).to.equal(getAddress(sender.account.address));
            expect(events[0].args.receiver).to.equal(getAddress(receiver.account.address));
            expect(events[0].args.amount).to.equal(iAUDAmount);
        });

        it("Should revert if non-sender executes payment", async function () {
            const amount = parseUnits("100", 6);

            await iEUR.write.approve([crossBorderPayment.address, amount], { account: sender.account });
            await crossBorderPayment.write.initPayment([receiver.account.address, amount], { account: sender.account });

            const iAUDAmount = parseUnits("150", 6);
            await crossBorderPayment.write.setFXRate([0n, iAUDAmount], { account: owner.account });

            try {
                await crossBorderPayment.write.executePayment([0n], { account: receiver.account });
                expect.fail("Should have reverted");
            } catch (error: any) {
                expect(error.message).to.include("Only sender can execute payment");
            }
        });
    });
});
