import BigNumber from "bignumber.js";
import { ARKTOSHI, SEPARATOR } from "../constants";
import { Payouts } from "../interfaces";
import { Config, logger } from "../services";

export class ProposalEngine {
    private readonly config: Config;

    constructor() {
        BigNumber.config({
            ROUNDING_MODE: BigNumber.ROUND_DOWN,
        });

        try {
            this.config = new Config();
        } catch (e) {
            logger.error(e.message);
            process.exit(1);
        }
    }

    public applyProposal(
        currentBlock: number,
        latestPayouts: Map<string, number>,
        smallWallets: Map<string, boolean>,
        payouts: Map<string, BigNumber>,
        feesPayouts: Map<string, BigNumber>
    ): Payouts {
        let totalPayout: BigNumber = new BigNumber(0);
        let delegateProfit: BigNumber = new BigNumber(0);
        let acfDonation: BigNumber = new BigNumber(0);

        for (const [address, balance] of payouts) {
            // TODO: OPTIMIZE THIS
            if (
                this.isFrequencyMinimumReached(
                    address,
                    currentBlock,
                    latestPayouts
                )
            ) {
                // Percentages
                const percentage: BigNumber = this.getSharePercentage(
                    address,
                    smallWallets
                );
                const acfPayout: BigNumber = new BigNumber(
                    balance
                        .times(this.config.donationShare)
                        .integerValue(BigNumber.ROUND_CEIL)
                );
                const voterPayout: BigNumber = new BigNumber(
                    balance.times(percentage).integerValue(BigNumber.ROUND_DOWN)
                );
                const delegatePayout: BigNumber = new BigNumber(balance)
                    .minus(acfPayout)
                    .minus(voterPayout);

                delegateProfit = delegateProfit.plus(delegatePayout);
                acfDonation = acfDonation.plus(acfPayout);

                let voterFeePayout: BigNumber = new BigNumber(0);
                const feePayout: BigNumber = feesPayouts.get(address);
                if (!feePayout.isNaN() && feePayout.gt(0)) {
                    voterFeePayout = new BigNumber(
                        feePayout
                            .times(this.config.voterFeeShare)
                            .integerValue(BigNumber.ROUND_DOWN)
                    );
                    feesPayouts.set(address, voterFeePayout);
                    delegateProfit = delegateProfit.plus(
                        feePayout.minus(voterFeePayout)
                    );
                }
                payouts.set(address, voterPayout.plus(voterFeePayout));

                if (
                    payouts.get(address).lt(this.config.minimalPayoutValue) ||
                    payouts.get(address).eq(0)
                ) {
                    if (payouts.get(address).gt(0)) {
                        logger.warn(
                            `Payout to ${address} pending (min. value ${this.config.minimalPayoutValue
                                .div(ARKTOSHI)
                                .toNumber()}): ${payouts
                                .get(address)
                                .div(ARKTOSHI)
                                .toFixed(8)}`
                        );
                    }
                    payouts.delete(address);
                } else {
                    totalPayout = totalPayout.plus(payouts.get(address));
                }
            } else {
                payouts.delete(address);
            }
        }

        // FairFees
        const multiPaymentFees: BigNumber = new BigNumber(payouts.size)
            .div(this.config.transactionsPerMultitransfer)
            .integerValue(BigNumber.ROUND_CEIL)
            .times(this.config.multiTransferFee);
        const totalFees: BigNumber = this.config.transferFee
            .times(this.getAdminFeeCount() + this.getACFFeeCount())
            .plus(multiPaymentFees);
        for (const [address, balance] of payouts) {
            const fairFees: BigNumber = balance
                .div(totalPayout)
                .times(totalFees);
            payouts.set(address, balance.minus(fairFees));
        }

        logger.info(SEPARATOR);
        logger.info(
            `Next payout run: ${
                payouts.size
            } share payouts with total amount: ${totalPayout
                .plus(delegateProfit)
                .plus(acfDonation)
                .div(ARKTOSHI)
                .toFixed(8)}:`
        );
        logger.info(`Voter Share: ${totalPayout.div(ARKTOSHI).toFixed(8)}`);
        logger.info(
            `Delegate Profits: ${delegateProfit.div(ARKTOSHI).toFixed(8)}`
        );
        logger.info(`License Fee: ${acfDonation.div(ARKTOSHI).toFixed(8)}`);
        logger.info(`Transaction Fees: ${totalFees.div(ARKTOSHI).toFixed(8)}`);
        logger.info(SEPARATOR);

        return { payouts, acfDonation, delegateProfit, timestamp: 0 };
    }

    /*
        Returns true if no custom frequency is set, the address hasn't yet received a disbursement,
        or the current block has now passed the custom minimum threshold. Returns false otherwise.
      */
    public isFrequencyMinimumReached(
        address: string,
        currentBlock: number,
        latestPayouts
    ): boolean {
        const frequency: number = this.getFrequencyAddress(address);
        const lastPayoutHeight = latestPayouts.get(address);

        if (!lastPayoutHeight || !frequency) {
            return true;
        }

        const blockMinimums: number = lastPayoutHeight + frequency;
        if (blockMinimums < currentBlock) {
            return true;
        }

        logger.warn(
            `Payout to ${address} pending (delay of ${frequency} blocks not yet reached) [${blockMinimums}/${currentBlock}]`
        );
        return false;
    }

    public getFrequencyAddress(address: string): number {
        if (
            this.config.customPayoutFrequencies.hasOwnProperty(address) ===
                true &&
            typeof this.config.customPayoutFrequencies[address] === "number"
        ) {
            return this.config.customPayoutFrequencies[address];
        }
        return 0;
    }

    public getSharePercentage(address: string, smallWallets): BigNumber {
        if (this.config.customShares.hasOwnProperty(address) === true) {
            logger.info(
                `Custom share percentage found for ${address}: ${new BigNumber(
                    this.config.customShares[address]
                )
                    .times(100)
                    .toString()}%`
            );
            const customShare: BigNumber = new BigNumber(
                this.config.customShares[address]
            );
            if (customShare.plus(this.config.donationShare).gt(1)) {
                logger.warn(
                    `Custom share percentage for ${address} is larger than 100%: percentage has been capped at 100%`
                );
                return customShare.minus(this.config.donationShare);
            }
            if (customShare.lt(0)) {
                logger.warn(
                    `Custom share percentage for ${address} is smaller than 0%: percentage has been capped at 0%`
                );
                return new BigNumber(0);
            }
            return customShare;
        }

        // check if maximum wallet balance for this voter is <= small wallet limit and then return small wallet share
        if (smallWallets.get(address) === true) {
            return this.config.smallWalletBonus.percentage;
        }
        return this.config.voterShare;
    }

    public getAdminFeeCount(): number {
        const ADMIN_PAYOUT_LIST = process.env.ADMIN_PAYOUT_LIST
            ? JSON.parse(process.env.ADMIN_PAYOUT_LIST)
            : {};
        return Object.keys(ADMIN_PAYOUT_LIST).length;
    }

    public getACFFeeCount(): number {
        if (this.config.donationShare.gt(0)) {
            return 1;
        }
        return 0;
    }
}
